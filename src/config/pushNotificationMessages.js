/**
 * Push notification title and body text (FCM).
 * Bangla-friendly, professional tone.
 */
module.exports = {
  // When a teacher starts a live lesson (enrolled students). Body uses course name.
  liveStarted: (courseName) => ({
    title: 'শিক্ষাভূমি – লাইভ ক্লাস শুরু',
    body: `"${courseName}" এর লাইভ ক্লাস শুরু হয়েছে। এখনই যোগ দিন।`,
  }),

  // When a teacher's withdrawal request is accepted
  withdrawAccepted: {
    title: 'শিক্ষাভূমি – Withdrawal accepted',
    body: 'আপনার উত্তোলন অনুমোদিত হয়েছে। টাকা শীঘ্রই আপনার পেমেন্ট পদ্ধতিতে পাঠানো হবে।',
  },

  // When a teacher's withdrawal request is declined
  withdrawDeclined: (reason) => ({
    title: 'শিক্ষাভূমি – Withdrawal declined',
    body: reason
      ? `আপনার উত্তোলন প্রত্যাখ্যান হয়েছে। কারণ: ${reason}`
      : 'আপনার উত্তোলন প্রত্যাখ্যান হয়েছে। বিস্তারিত জানতে সাপোর্টে যোগাযোগ করুন।',
  }),

  // When a student's payment is accepted
  paymentAccepted: (courseTitle) => ({
    title: 'শিক্ষাভূমি – Payment accepted',
    body: `"${courseTitle}" কোর্সের পেমেন্ট সফলভাবে গ্রহণ করা হয়েছে। এখন আপনি কোর্স এক্সেস করতে পারবেন।`,
  }),

  // When a student's payment request is declined
  paymentDeclined: (courseTitle) => ({
    title: 'শিক্ষাভূমি – Payment declined',
    body: `"${courseTitle}" এর পেমেন্ট প্রত্যাখ্যান হয়েছে। কোনো প্রশ্ন থাকলে সাপোর্টে যোগাযোগ করুন।`,
  }),
};
