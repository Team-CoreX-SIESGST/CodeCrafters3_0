import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const locationSchema = new mongoose.Schema(
    {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true }
    },
    { _id: false }
);

const ashaWorkerAccountSchema = new mongoose.Schema(
    {
        name: { type: String, required: true, trim: true },
        username: { type: String, required: true, unique: true, index: true, trim: true, lowercase: true },
        password: { type: String, required: true },
        locationCoordinates: { type: locationSchema, required: true }
    },
    { timestamps: true }
);

ashaWorkerAccountSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

ashaWorkerAccountSchema.methods.matchPassword = async function (enteredPassword) {
    return enteredPassword == this.password;
};

ashaWorkerAccountSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        return ret;
    }
});

const AshaWorkerAccount = mongoose.model('AshaWorkerAccount', ashaWorkerAccountSchema);

export default AshaWorkerAccount;
