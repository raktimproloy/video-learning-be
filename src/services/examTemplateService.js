const crypto = require('crypto');
const mammoth = require('mammoth');

const OPTION_LINE = /^([A-Za-z])\)\s*(.*)$/;
const ANSWER_LINE = /^ANSWER:\s*(.+)$/i;
const MARKS_LINE = /^MARKS:\s*([\d.]+)$/i;
const SOLUTION_LINE = /^SOLUTION:\s*(.*)$/i;

/**
 * Parses the lines of a single question block (between [Q]/[QN] and [/Q]/[/QN],
 * exclusive of the markers) into a question object.
 */
function parseQuestionBlock(blockLines) {
    const textLines = [];
    const options = [];
    const solutionLines = [];
    const warnings = [];
    let answerLetter = null;
    let marks = 1;
    let state = 'text'; // text -> options -> solution

    for (const rawLine of blockLines) {
        const line = rawLine.trim();
        if (!line) continue;

        const optionMatch = line.match(OPTION_LINE);
        const answerMatch = line.match(ANSWER_LINE);
        const marksMatch = line.match(MARKS_LINE);
        const solutionMatch = line.match(SOLUTION_LINE);

        if (optionMatch && state !== 'solution') {
            options.push({ letter: optionMatch[1].toUpperCase(), text: optionMatch[2].trim() });
            state = 'options';
        } else if (answerMatch) {
            answerLetter = answerMatch[1].trim().charAt(0).toUpperCase();
        } else if (marksMatch) {
            const parsed = parseFloat(marksMatch[1]);
            marks = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
        } else if (solutionMatch) {
            state = 'solution';
            if (solutionMatch[1].trim()) solutionLines.push(solutionMatch[1].trim());
        } else if (state === 'solution') {
            solutionLines.push(line);
        } else if (state === 'text') {
            textLines.push(line);
        } else {
            warnings.push(`Unrecognized line ignored: "${line}"`);
        }
    }

    const builtOptions = options.map((o) => ({ id: crypto.randomUUID(), text: o.text, imagePath: null, _letter: o.letter }));
    let correctOptionId = null;
    if (answerLetter) {
        const match = builtOptions.find((o) => o._letter === answerLetter);
        if (match) correctOptionId = match.id;
        else warnings.push(`ANSWER: ${answerLetter} does not match any option letter`);
    } else {
        warnings.push('No ANSWER: line found for a question — correct answer will need to be set manually');
    }

    return {
        text: textLines.join('\n').trim(),
        options: builtOptions.map(({ _letter, ...o }) => o),
        correctOptionId,
        marks,
        solutionText: solutionLines.join('\n').trim() || null,
        solutionImagePath: null,
        warnings,
    };
}

/**
 * Parses the plain-text export of the exam template DOCX into structured questions.
 * Strict marker convention: [Q]...[/Q] for a standalone MCQ, [PASSAGE]...[Q1]...[/Q1]...[/PASSAGE]
 * for a passage with sub-questions. Anything else is reported as a warning, never silently dropped.
 */
function parseExamTemplateText(text) {
    const lines = String(text || '').split(/\r?\n/);
    const questions = [];
    const warnings = [];
    let order = 0;
    let i = 0;

    while (i < lines.length) {
        const line = lines[i].trim();
        if (!line) {
            i += 1;
            continue;
        }

        if (/^\[Q\]$/i.test(line)) {
            const endIdx = lines.findIndex((l, idx) => idx > i && /^\[\/Q\]$/i.test(l.trim()));
            if (endIdx === -1) {
                warnings.push(`Line ${i + 1}: [Q] block never closed with [/Q] — skipped`);
                i += 1;
                continue;
            }
            const block = parseQuestionBlock(lines.slice(i + 1, endIdx));
            questions.push({
                id: crypto.randomUUID(),
                type: 'mcq',
                order: order++,
                imagePath: null,
                ...block,
            });
            warnings.push(...block.warnings.map((w) => `Q${order}: ${w}`));
            i = endIdx + 1;
            continue;
        }

        if (/^\[PASSAGE\]$/i.test(line)) {
            const passageEndIdx = lines.findIndex((l, idx) => idx > i && /^\[\/PASSAGE\]$/i.test(l.trim()));
            if (passageEndIdx === -1) {
                warnings.push(`Line ${i + 1}: [PASSAGE] block never closed with [/PASSAGE] — skipped`);
                i += 1;
                continue;
            }
            const firstSubQIdx = lines.findIndex((l, idx) => idx > i && idx < passageEndIdx && /^\[Q\d+\]$/i.test(l.trim()));
            const passageTextLines = lines.slice(i + 1, firstSubQIdx === -1 ? passageEndIdx : firstSubQIdx);
            const passageText = passageTextLines.map((l) => l.trim()).filter(Boolean).join('\n');

            const subQuestions = [];
            let cursor = firstSubQIdx === -1 ? passageEndIdx : firstSubQIdx;
            let subOrder = 0;
            while (cursor !== -1 && cursor < passageEndIdx) {
                const subLine = lines[cursor].trim();
                const subMatch = subLine.match(/^\[Q(\d+)\]$/i);
                if (!subMatch) {
                    if (subLine) warnings.push(`Line ${cursor + 1}: expected [Q#] inside passage, got "${subLine}"`);
                    cursor += 1;
                    continue;
                }
                const closeTag = `[/Q${subMatch[1]}]`;
                const subEndIdx = lines.findIndex(
                    (l, idx) => idx > cursor && idx <= passageEndIdx && l.trim().toUpperCase() === closeTag.toUpperCase()
                );
                if (subEndIdx === -1) {
                    warnings.push(`Line ${cursor + 1}: [Q${subMatch[1]}] never closed with ${closeTag} — skipped`);
                    cursor += 1;
                    continue;
                }
                const block = parseQuestionBlock(lines.slice(cursor + 1, subEndIdx));
                subQuestions.push({ id: crypto.randomUUID(), order: subOrder++, imagePath: null, ...block });
                warnings.push(...block.warnings.map((w) => `Passage sub-question ${subOrder}: ${w}`));
                cursor = subEndIdx + 1;
            }

            if (subQuestions.length === 0) {
                warnings.push(`Passage starting at line ${i + 1} has no valid sub-questions — skipped`);
            } else {
                questions.push({
                    id: crypto.randomUUID(),
                    type: 'mcq_n',
                    order: order++,
                    passageText,
                    passageImagePath: null,
                    subQuestions: subQuestions.map(({ warnings: _w, ...sq }) => sq),
                });
            }
            i = passageEndIdx + 1;
            continue;
        }

        warnings.push(`Line ${i + 1}: unrecognized text outside any [Q]/[PASSAGE] block: "${line}"`);
        i += 1;
    }

    return { questions, warnings };
}

/** Extracts raw text from an uploaded DOCX buffer and parses it. Reports embedded-image count as a warning (images are not auto-attached — see plan). */
async function parseExamTemplateDocx(buffer) {
    const { value: text } = await mammoth.extractRawText({ buffer });
    const { questions, warnings } = parseExamTemplateText(text);

    let imageWarning = [];
    try {
        let imageCount = 0;
        await mammoth.convertToHtml(
            { buffer },
            { convertImage: mammoth.images.imgElement(async () => { imageCount += 1; return {}; }) }
        );
        if (imageCount > 0) {
            imageWarning = [`${imageCount} image(s) found in the document but not auto-attached — add them manually via the image upload button on each question/option/solution.`];
        }
    } catch (_) {
        // best-effort only; text parsing above is the primary result
    }

    return { questions, warnings: [...warnings, ...imageWarning] };
}

module.exports = { parseExamTemplateText, parseExamTemplateDocx };
