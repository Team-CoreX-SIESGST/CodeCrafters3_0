import mongoose from 'mongoose';

const doctorSchema = new mongoose.Schema(
    {
        doctorId: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true, trim: true },
        specialization: { type: String, required: true, trim: true },
        qualification: { type: String, trim: true },
        registrationNumber: { type: String, trim: true },
        facility: { type: String, trim: true },
        availableDays: [{ type: String, trim: true }],
        consultationHours: { type: String, trim: true },
        telemedicineAvailable: { type: Boolean, default: false },
        languages: [{ type: String, trim: true }]
    },
    {
        timestamps: true
    }
);

const Doctor = mongoose.model('DoctorData', doctorSchema, 'doctors_data');

export default Doctor;
