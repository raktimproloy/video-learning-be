const db = require('../../db');
const userNotificationService = require('./userNotificationService');
const teacherInstituteService = require('./teacherInstituteService');

class InstituteAffiliationService {
  async sendInvite(ownerTeacherId, targetEmail) {
    const email = String(targetEmail || '').trim().toLowerCase();
    if (!email) {
      const err = new Error('Email is required');
      err.status = 400;
      throw err;
    }

    const institute = await teacherInstituteService.getByTeacherId(ownerTeacherId);
    if (!institute) {
      const err = new Error('You must set up your institute before inviting teachers.');
      err.status = 400;
      throw err;
    }

    const targetUserRes = await db.query(
      `SELECT id, email, name, role FROM users WHERE LOWER(email) = $1 LIMIT 1`,
      [email]
    );

    if (targetUserRes.rows.length === 0) {
      const err = new Error('No user found with this email.');
      err.status = 404;
      throw err;
    }

    const targetUser = targetUserRes.rows[0];
    if (targetUser.role !== 'teacher') {
      const err = new Error('Invited user must be a registered teacher.');
      err.status = 400;
      throw err;
    }

    if (targetUser.id === ownerTeacherId) {
      const err = new Error('You cannot invite yourself.');
      err.status = 400;
      throw err;
    }

    const existingAffiliation = await db.query(
      `SELECT id, status FROM institute_affiliations WHERE institute_id = $1 AND teacher_id = $2 LIMIT 1`,
      [institute.id, targetUser.id]
    );

    if (existingAffiliation.rows.length > 0) {
      const status = existingAffiliation.rows[0].status;
      if (status === 'pending') {
        const err = new Error('An invitation is already pending for this teacher.');
        err.status = 400;
        throw err;
      }
      if (status === 'accepted') {
        const err = new Error('This teacher is already affiliated with your institute.');
        err.status = 400;
        throw err;
      }
    }

    const res = await db.query(
      `INSERT INTO institute_affiliations (institute_id, teacher_id, invited_by, status, responded_at)
       VALUES ($1, $2, $3, 'pending', NULL)
       ON CONFLICT (institute_id, teacher_id)
       DO UPDATE SET status = 'pending', invited_by = EXCLUDED.invited_by, responded_at = NULL, updated_at = NOW()
       RETURNING *`,
      [institute.id, targetUser.id, ownerTeacherId]
    );
    const affiliation = res.rows[0];

    try {
      await userNotificationService.create(targetUser.id, {
        type: 'institute_invite',
        title: 'Institute Invitation',
        body: `You have been invited to join ${institute.name}.`,
        link: '/teacher/institute-requests'
      });
    } catch (e) {
      console.warn('Failed to send notification for institute invite:', e);
    }

    return { ...affiliation, target_email: targetUser.email, target_name: targetUser.name };
  }

  async respondToInvite(teacherId, affiliationId, accept) {
    const existing = await db.query(
      `SELECT * FROM institute_affiliations WHERE id = $1 AND teacher_id = $2 AND status = 'pending' LIMIT 1`,
      [affiliationId, teacherId]
    );

    if (existing.rows.length === 0) {
      const err = new Error('Invitation not found or already processed.');
      err.status = 404;
      throw err;
    }

    const newStatus = accept ? 'accepted' : 'refused';
    let isMain = false;

    if (accept) {
      // Check if this is the first accepted affiliation AND they don't own an institute
      const ownedInstitute = await teacherInstituteService.getByTeacherId(teacherId);
      if (!ownedInstitute) {
        const otherAccepted = await db.query(
          `SELECT 1 FROM institute_affiliations WHERE teacher_id = $1 AND status = 'accepted' LIMIT 1`,
          [teacherId]
        );
        if (otherAccepted.rows.length === 0) {
          isMain = true;
        }
      }
    }

    const res = await db.query(
      `UPDATE institute_affiliations
       SET status = $1, is_main = $2, responded_at = NOW(), updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [newStatus, isMain, affiliationId]
    );

    return res.rows[0];
  }

  async listIncomingRequests(teacherId) {
    const res = await db.query(
      `SELECT ia.id, ia.status, ia.created_at, ti.name AS institute_name, ti.logo_path AS institute_logo_path, ti.tagline AS institute_tagline
       FROM institute_affiliations ia
       JOIN teacher_institutes ti ON ti.id = ia.institute_id
       WHERE ia.teacher_id = $1 AND ia.status = 'pending'
       ORDER BY ia.created_at DESC`,
      [teacherId]
    );
    
    // Enrich media urls
    const base = (process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000').replace(/\/v1\/?$/, '');
    return res.rows.map(row => {
      if (row.institute_logo_path) {
        row.institute_logo_url = `${base}/v1/institutes/media/${encodeURIComponent(row.institute_logo_path)}`;
      }
      return row;
    });
  }

  async listSentRequests(ownerTeacherId) {
    const institute = await teacherInstituteService.getByTeacherId(ownerTeacherId);
    if (!institute) return [];

    const res = await db.query(
      `SELECT ia.id, ia.status, ia.created_at, ia.responded_at, ia.tag, u.email AS target_email, u.name AS target_name,
              tp.profile_image_path
       FROM institute_affiliations ia
       JOIN users u ON u.id = ia.teacher_id
       LEFT JOIN teacher_profiles tp ON tp.user_id = ia.teacher_id
       WHERE ia.institute_id = $1
       ORDER BY ia.created_at DESC`,
      [institute.id]
    );

    const base = (process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000').replace(/\/v1\/?$/, '');
    return res.rows.map(row => {
      let profileImageUrl = null;
      if (row.profile_image_path) {
        const pPath = String(row.profile_image_path);
        if (pPath.startsWith('teachers/')) {
          profileImageUrl = `${base}/v1/teacher/profile/image/${encodeURIComponent(pPath)}`;
        } else if (pPath.startsWith('/images/') || pPath.startsWith('images/')) {
          profileImageUrl = `${base}${pPath.startsWith('/') ? '' : '/'}${pPath}`;
        }
      }
      row.target_profile_image_url = profileImageUrl;
      return row;
    });
  }

  async listMyAffiliations(teacherId) {
    const list = [];
    
    // Own institute
    const ownedInstitute = await teacherInstituteService.getByTeacherId(teacherId);
    let hasMainAffiliation = false;
    
    // Affiliated institutes
    const affiliationsRes = await db.query(
      `SELECT ia.id AS affiliation_id, ia.is_main, ti.id AS institute_id, ti.name, ti.slug, ti.logo_path, ti.tagline, ti.email, ti.phone
       FROM institute_affiliations ia
       JOIN teacher_institutes ti ON ti.id = ia.institute_id
       WHERE ia.teacher_id = $1 AND ia.status = 'accepted'
       ORDER BY ia.created_at DESC`,
      [teacherId]
    );
    
    const base = (process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000').replace(/\/v1\/?$/, '');

    const affiliations = affiliationsRes.rows.map(row => {
      if (row.is_main) hasMainAffiliation = true;
      let logoUrl = null;
      if (row.logo_path) {
        logoUrl = `${base}/v1/institutes/media/${encodeURIComponent(row.logo_path)}`;
      }
      return {
        id: row.institute_id,
        affiliation_id: row.affiliation_id,
        role: 'member',
        name: row.name,
        slug: row.slug,
        logo_url: logoUrl,
        tagline: row.tagline,
        email: row.email,
        phone: row.phone,
        is_main: row.is_main
      };
    });

    if (ownedInstitute) {
      list.push({
        id: ownedInstitute.id,
        affiliation_id: null,
        role: 'owner',
        name: ownedInstitute.name,
        slug: ownedInstitute.slug,
        logo_url: ownedInstitute.logo_url,
        tagline: ownedInstitute.tagline,
        email: ownedInstitute.email,
        phone: ownedInstitute.phone,
        // The owned institute is "main" if no affiliation is main
        is_main: !hasMainAffiliation
      });
    }

    list.push(...affiliations);
    return list;
  }

  async setMainInstitute(teacherId, instituteId) {
    const ownedInstitute = await teacherInstituteService.getByTeacherId(teacherId);
    
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      
      // If targeting the owned institute, simply set all affiliations to is_main = false
      if (ownedInstitute && ownedInstitute.id === instituteId) {
        await client.query(
          `UPDATE institute_affiliations SET is_main = false WHERE teacher_id = $1`,
          [teacherId]
        );
      } else {
        // Validate target is an accepted affiliation
        const targetRes = await client.query(
          `SELECT id FROM institute_affiliations WHERE teacher_id = $1 AND institute_id = $2 AND status = 'accepted' LIMIT 1`,
          [teacherId, instituteId]
        );
        
        if (targetRes.rows.length === 0) {
          const err = new Error('Institute not found or not accepted.');
          err.status = 404;
          throw err;
        }

        // Set all to false
        await client.query(
          `UPDATE institute_affiliations SET is_main = false WHERE teacher_id = $1`,
          [teacherId]
        );

        // Set target to true
        await client.query(
          `UPDATE institute_affiliations SET is_main = true WHERE id = $1`,
          [targetRes.rows[0].id]
        );
      }

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  }

  async leaveInstitute(teacherId, affiliationId) {
    const res = await db.query(
      `UPDATE institute_affiliations
       SET status = 'left', is_main = false, updated_at = NOW()
       WHERE id = $1 AND teacher_id = $2 AND status = 'accepted'
       RETURNING *`,
      [affiliationId, teacherId]
    );

    if (res.rows.length === 0) {
      const err = new Error('Affiliation not found or cannot be left.');
      err.status = 404;
      throw err;
    }

    return res.rows[0];
  }

  async removeAffiliate(ownerTeacherId, affiliationId) {
    const institute = await teacherInstituteService.getByTeacherId(ownerTeacherId);
    if (!institute) {
      const err = new Error('You do not own an institute.');
      err.status = 400;
      throw err;
    }

    const res = await db.query(
      `UPDATE institute_affiliations
       SET status = 'removed', is_main = false, updated_at = NOW()
       WHERE id = $1 AND institute_id = $2 AND status = 'accepted'
       RETURNING *`,
      [affiliationId, institute.id]
    );

    if (res.rows.length === 0) {
      const err = new Error('Affiliate not found or already removed.');
      err.status = 404;
      throw err;
    }

    return res.rows[0];
  }

  async updateTag(ownerTeacherId, affiliationId, tag) {
    const institute = await teacherInstituteService.getByTeacherId(ownerTeacherId);
    if (!institute) {
      const err = new Error('You do not own an institute.');
      err.status = 400;
      throw err;
    }

    const res = await db.query(
      `UPDATE institute_affiliations
       SET tag = $1, updated_at = NOW()
       WHERE id = $2 AND institute_id = $3 AND status = 'accepted'
       RETURNING *`,
      [tag || null, affiliationId, institute.id]
    );

    if (res.rows.length === 0) {
      const err = new Error('Affiliate not found or not accepted.');
      err.status = 404;
      throw err;
    }

    return res.rows[0];
  }

  async listInstituteTeachers(instituteId) {
    // 1. Get owner
    const instituteRes = await db.query(
      `SELECT ti.teacher_id, u.name AS teacher_name, tp.profile_image_path, tp.specialization
       FROM teacher_institutes ti
       JOIN users u ON u.id = ti.teacher_id
       LEFT JOIN teacher_profiles tp ON tp.user_id = ti.teacher_id
       WHERE ti.id = $1 LIMIT 1`,
      [instituteId]
    );
    
    if (instituteRes.rows.length === 0) return [];

    const ownerRow = instituteRes.rows[0];
    
    // 2. Get accepted affiliates
    const affiliatesRes = await db.query(
      `SELECT ia.teacher_id, ia.tag, u.name AS teacher_name, tp.profile_image_path, tp.specialization
       FROM institute_affiliations ia
       JOIN users u ON u.id = ia.teacher_id
       LEFT JOIN teacher_profiles tp ON tp.user_id = ia.teacher_id
       WHERE ia.institute_id = $1 AND ia.status = 'accepted'
       ORDER BY ia.created_at ASC`,
      [instituteId]
    );

    const base = (process.env.BASE_URL || process.env.API_URL || 'http://localhost:5000').replace(/\/v1\/?$/, '');
    
    const formatTeacher = (row, role) => {
      let profileImageUrl = null;
      if (row.profile_image_path) {
        const pPath = String(row.profile_image_path);
        if (pPath.startsWith('teachers/')) {
          profileImageUrl = `${base}/v1/teacher/profile/image/${encodeURIComponent(pPath)}`;
        } else if (pPath.startsWith('/images/') || pPath.startsWith('images/')) {
          profileImageUrl = `${base}${pPath.startsWith('/') ? '' : '/'}${pPath}`;
        }
      }
      return {
        id: row.teacher_id,
        name: row.teacher_name,
        designation: row.tag || (Array.isArray(row.specialization) ? row.specialization.join(', ') : (row.specialization || '')),
        profile_image_url: profileImageUrl,
        role
      };
    };

    const list = [formatTeacher(ownerRow, 'owner')];
    for (const row of affiliatesRes.rows) {
      list.push(formatTeacher(row, 'member'));
    }
    
    return list;
  }
}

module.exports = new InstituteAffiliationService();
