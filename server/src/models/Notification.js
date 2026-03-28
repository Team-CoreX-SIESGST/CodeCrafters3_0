import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema(
    {
        doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorAccount', required: true },
        patient: { type: mongoose.Schema.Types.ObjectId, ref: 'PatientData', required: true },
        appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment', required: true },
        message: { type: String, required: true, trim: true },
        data: { type: mongoose.Schema.Types.Mixed },
        read: { type: Boolean, default: false }
    },
    { timestamps: true }
);

const Notification = mongoose.model('Notification', notificationSchema);

export default Notification;
