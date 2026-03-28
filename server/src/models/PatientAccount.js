import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
    {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    { _id: false }
);

const patientAccountSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        abhaId: { type: String, required: true, unique: true, index: true, trim: true },
        phoneNumber: { type: String, required: true, trim: true },
        locationCoordinates: { type: locationSchema, required: true }
    },
    { timestamps: true }
);

const PatientAccount = mongoose.model('PatientAccount', patientAccountSchema);

export default PatientAccount;
