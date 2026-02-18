const db = require('../../db');
const bcrypt = require('bcryptjs');

class UserPasswordService {
    /**
     * Change password for any user (works for both student and teacher roles)
     * Since one account can have both roles, we change the password in the users table
     */
    async changePassword(userId, currentPassword, newPassword) {
        // Get current password hash
        const userResult = await db.query(
            `SELECT password_hash FROM users WHERE id = $1`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            throw new Error('User not found');
        }

        const user = userResult.rows[0];

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password_hash);
        if (!isValidPassword) {
            throw new Error('Current password is incorrect');
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const newPasswordHash = await bcrypt.hash(newPassword, salt);

        // Update password in users table (affects both student and teacher roles)
        await db.query(
            `UPDATE users SET password_hash = $1 WHERE id = $2`,
            [newPasswordHash, userId]
        );

        return { success: true, message: 'Password changed successfully' };
    }
}

module.exports = new UserPasswordService();
