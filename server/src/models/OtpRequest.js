import mongoose from 'mongoose';

const otpRequestSchema = new mongoose.Schema(
    {
        phoneNumber: { type: String, required: true, index: true },
        role: { type: String, required: true, index: true },
        otpHash: { type: String, required: true },
        expiresAt: { type: Date, required: true, index: true, expires: 0 },
        attempts: { type: Number, default: 0 },
        verifiedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

otpRequestSchema.index({ phoneNumber: 1, createdAt: -1 });

const OtpRequest = mongoose.model('OtpRequest', otpRequestSchema);

export default OtpRequest;
