import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const locationSchema = new mongoose.Schema(
    {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    { _id: false }
);

const doctorAccountSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        username: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
        password: { type: String, required: true },
        phoneNumber: { type: String, trim: true, index: true },
        specialization: { type: String, trim: true },
        qualification: { type: String, trim: true },
        registrationId: { type: String, trim: true },
        experienceYears: { type: Number },
        about: { type: String, trim: true },
        languages: [{ type: String, trim: true }],
        availability: { type: String, trim: true },
        hospitalName: { type: String, required: true, trim: true },
        locationCoordinates: { type: locationSchema, required: true },
        availableSlots: [{ type: String, trim: true }]
    },
    { timestamps: true }
);

doctorAccountSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

doctorAccountSchema.methods.matchPassword = async function (enteredPassword) {
    return enteredPassword== this.password;
};

doctorAccountSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        return ret;
    }
});

const DoctorAccount = mongoose.model('DoctorAccount', doctorAccountSchema);

export default DoctorAccount;
