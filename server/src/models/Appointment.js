import mongoose from 'mongoose';

const appointmentSchema = new mongoose.Schema(
    {
        patient: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'PatientData',
            required: true
        },
        doctor: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DoctorAccount',
            required: true
        },
        appointmentType: {
            type: String,
            enum: ['OFFLINE', 'VIDEO_CALL', 'AUDIO_CALL'],
            default: 'OFFLINE'
        },
        problem: { type: String, required: true, trim: true },
        symptoms: { type: String, trim: true },
        description: { type: String, trim: true },
        structuredQuery: { type: String, trim: true },
        preferredDate: { type: String, required: true, trim: true },
        preferredTime: { type: String, required: true, trim: true },
        urgencyScore: { type: Number, default: 0 },
        aiSummary: { type: String, trim: true },
        conversationTranscript: { type: String, trim: true },
        conversationSummary: { type: String, trim: true },
        conversationInsights: { type: String, trim: true },
        videoLink: { type: String, trim: true },
        status: {
            type: String,
            enum: ['BOOKED', 'IN_CALL', 'CANCELLED', 'COMPLETED'],
            default: 'BOOKED'
        }
    },
    { timestamps: true }
);

const Appointment = mongoose.model('Appointment', appointmentSchema);

export default Appointment;
