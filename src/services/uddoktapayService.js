const axios = require('axios');

const UDDOKTAPAY_API_KEY = process.env.UDDOKTAPAY_API_KEY || '982d381360a69d419689740d9f2e26ce36fb7a50';
const rawBaseUrl = process.env.UDDOKTAPAY_BASE_URL || 'https://sandbox.uddoktapay.com';
const UDDOKTAPAY_BASE_URL = rawBaseUrl.replace(/\/$/, '').replace(/\/api$/, '');

/**
 * Initiate a payment checkout session with UddoktaPay.
 * 
 * @param {Object} params
 * @param {string} params.fullName - Customer full name
 * @param {string} params.email - Customer email
 * @param {number|string} params.amount - Amount in BDT
 * @param {Object} params.metadata - Custom metadata dictionary
 * @param {string} params.redirectUrl - URL to redirect student after payment
 * @param {string} params.cancelUrl - URL to redirect student if cancelled
 * @param {string} params.webhookUrl - IPN webhook callback URL
 * @returns {Promise<{ success: boolean, paymentUrl?: string, message: string }>}
 */
async function initiatePayment({ fullName, email, amount, metadata, redirectUrl, cancelUrl, webhookUrl }) {
    const url = `${UDDOKTAPAY_BASE_URL.replace(/\/$/, '')}/api/checkout-v2`;
    const payload = {
        full_name: fullName,
        email: email,
        amount: String(parseFloat(amount)),
        metadata: metadata || {},
        redirect_url: redirectUrl,
        cancel_url: cancelUrl,
        webhook_url: webhookUrl,
        return_type: 'GET'
    };

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'RT-UDDOKTAPAY-API-KEY': UDDOKTAPAY_API_KEY
    };

    try {
        console.log('UddoktaPay checkout-v2 request:', { url, payload: { ...payload, metadata: '...' } });
        const response = await axios.post(url, payload, { headers, timeout: 15000 });
        const data = response.data || {};
        console.log('UddoktaPay checkout-v2 response:', { status: response.status, data });
        if (data.status === true && data.payment_url) {
            return {
                success: true,
                paymentUrl: data.payment_url,
                message: data.message || 'Payment initiated'
            };
        } else {
            console.warn('UddoktaPay initiate payment returned failure response:', data);
            return {
                success: false,
                message: data.message || 'Payment initiation failed'
            };
        }
    } catch (error) {
        const errData = error.response?.data;
        const errStatus = error.response?.status;
        console.error('UddoktaPay initiate payment error:', {
            status: errStatus,
            data: errData,
            message: error.message,
            url,
            redirectUrl: payload.redirect_url,
            cancelUrl: payload.cancel_url,
            webhookUrl: payload.webhook_url,
        });
        const errMsg = errData?.message || error.message || 'UddoktaPay checkout API request failed';
        return {
            success: false,
            message: errMsg
        };
    }
}

/**
 * Verify a transaction status using the invoice_id.
 * 
 * @param {string} invoiceId - Invoice ID returned by UddoktaPay
 * @returns {Promise<{ success: boolean, status?: string, amount?: string, metadata?: Object, paymentMethod?: string, senderNumber?: string, transactionId?: string, date?: string, raw?: Object, message?: string }>}
 */
async function verifyPayment(invoiceId) {
    const url = `${UDDOKTAPAY_BASE_URL.replace(/\/$/, '')}/api/verify-payment`;
    const payload = {
        invoice_id: invoiceId
    };

    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'RT-UDDOKTAPAY-API-KEY': UDDOKTAPAY_API_KEY
    };

    try {
        const response = await axios.post(url, payload, { headers, timeout: 15000 });
        const data = response.data || {};
        
        return {
            success: true,
            status: data.status, // 'COMPLETED', 'PENDING', or 'ERROR'
            amount: data.amount,
            metadata: data.metadata,
            paymentMethod: data.payment_method,
            senderNumber: data.sender_number,
            transactionId: data.transaction_id,
            date: data.date,
            message: data.message,
            raw: data
        };
    } catch (error) {
        console.error('UddoktaPay verify payment error:', error.response?.data || error.message);
        const errMsg = error.response?.data?.message || error.message || 'UddoktaPay verification API request failed';
        return {
            success: false,
            message: errMsg
        };
    }
}

module.exports = {
    initiatePayment,
    verifyPayment,
    UDDOKTAPAY_API_KEY
};
