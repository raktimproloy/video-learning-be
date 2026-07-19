/**
 * One-off generator for the downloadable exam template DOCX (Bengali instructions).
 * Run with: node scripts/generate-exam-template.js
 * Requires the `docx` package temporarily installed (not a runtime dependency —
 * `npm install docx --no-save` before running, if node_modules/docx is missing).
 *
 * Note: the markers themselves ([Q], [/Q], [PASSAGE], ANSWER:, MARKS:, SOLUTION:)
 * must stay in English exactly as written — the backend parser
 * (examTemplateService.js) matches these exact English patterns.
 */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

function p(text, opts = {}) {
    return new Paragraph({ children: [new TextRun({ text, ...opts })] });
}

function heading(text) {
    return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function blank() {
    return new Paragraph({ text: '' });
}

const doc = new Document({
    sections: [
        {
            children: [
                new Paragraph({ text: 'প্রশ্ন টেমপ্লেট', heading: HeadingLevel.HEADING_1 }),
                p('নিচের ফরম্যাট অনুযায়ী প্রশ্ন লিখে এই ফাইলটি সেভ করে আপলোড করুন। মার্কারগুলো ([Q], [/Q] ইত্যাদি) হুবহু এভাবেই রাখতে হবে, পরিবর্তন করবেন না।'),
                blank(),

                heading('উদাহরণ ১ — সাধারণ প্রশ্ন'),
                p('[Q]'),
                p('বাংলাদেশের রাজধানীর নাম কী?'),
                p('A) চট্টগ্রাম'),
                p('B) ঢাকা'),
                p('C) খুলনা'),
                p('D) রাজশাহী'),
                p('ANSWER: B'),
                p('MARKS: 1'),
                p('SOLUTION: ঢাকা বাংলাদেশের রাজধানী।'),
                p('[/Q]'),
                blank(),
                p('ANSWER-এ সঠিক অপশনের অক্ষর দিন। MARKS না দিলে ডিফল্ট ১ মার্ক ধরা হবে। SOLUTION ঐচ্ছিক (না দিলেও চলবে)।', { italics: true }),
                blank(),

                heading('উদাহরণ ২ — অনুচ্ছেদ (Passage) সহ একাধিক প্রশ্ন'),
                p('একটি অনুচ্ছেদের নিচে ২-৩টি প্রশ্ন থাকলে এভাবে লিখুন:'),
                blank(),
                p('[PASSAGE]'),
                p('একটি ট্রেন প্রথম ঘণ্টায় ৬০ কিমি এবং দ্বিতীয় ঘণ্টায় ৯০ কিমি চলল।'),
                p('[Q1]'),
                p('মোট কত কিমি চলল?'),
                p('A) ১২০ কিমি'),
                p('B) ১৫০ কিমি'),
                p('ANSWER: B'),
                p('MARKS: 2'),
                p('[/Q1]'),
                p('[Q2]'),
                p('গড় গতিবেগ কত?'),
                p('A) ৬০ কিমি/ঘণ্টা'),
                p('B) ৭৫ কিমি/ঘণ্টা'),
                p('ANSWER: B'),
                p('MARKS: 2'),
                p('SOLUTION: মোট দূরত্ব / মোট সময় = ১৫০ / ২ = ৭৫'),
                p('[/Q2]'),
                p('[/PASSAGE]'),
                blank(),

                p('ছবি যোগ করতে চাইলে প্রশ্ন সেভ করার পর "বিল্ডার" পেজ থেকে সরাসরি আপলোড করুন — ওয়ার্ড ফাইলে বসানো ছবি স্বয়ংক্রিয়ভাবে সঠিক জায়গায় বসবে না।', { italics: true }),
                blank(),

                heading('এবার আপনার প্রশ্ন লিখুন'),
                p('[Q]'),
                p('আপনার প্রশ্ন এখানে লিখুন'),
                p('A) '),
                p('B) '),
                p('C) '),
                p('D) '),
                p('ANSWER: '),
                p('MARKS: 1'),
                p('SOLUTION: '),
                p('[/Q]'),
            ],
        },
    ],
});

const outPath = path.resolve(__dirname, '../../frontend/public/templates/exam-template.docx');
Packer.toBuffer(doc).then((buffer) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, buffer);
    console.log('Written:', outPath, buffer.length, 'bytes');
});
