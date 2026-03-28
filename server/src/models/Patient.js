import mongoose from 'mongoose';

const abhaProfileSchema = new mongoose.Schema(
    {
        healthIdNumber: { type: String, required: true },
        healthId: { type: String, index: true },
        name: { type: String, trim: true },
        firstName: { type: String, trim: true },
        middleName: { type: String, trim: true },
        lastName: { type: String, trim: true },
        gender: { type: String, trim: true },
        dateOfBirth: { type: String, trim: true },
        yearOfBirth: { type: String, trim: true },
        monthOfBirth: { type: String, trim: true },
        dayOfBirth: { type: String, trim: true },
        mobile: { type: String, trim: true },
        email: { type: String, trim: true, lowercase: true },
        profilePhoto: { type: String },
        kycPhoto: { type: String },
        authMethods: [{ type: String, trim: true }],
        kycVerified: { type: Boolean, default: false },
        verificationStatus: { type: String, trim: true },
        verificationSource: { type: String, trim: true },
        abha_id_card: { type: String, trim: true }
    },
    { _id: false }
);

const addressSchema = new mongoose.Schema(
    {
        addressLine: { type: String, trim: true },
        village: { type: String, trim: true },
        subDistrict: { type: String, trim: true },
        district: { type: String, trim: true },
        state: { type: String, trim: true },
        pincode: { type: String, trim: true },
        country: { type: String, trim: true }
    },
    { _id: false }
);

const healthRecordsSchema = new mongoose.Schema(
    {
        bloodGroup: { type: String, trim: true },
        height_cm: { type: Number },
        weight_kg: { type: Number },
        bmi: { type: Number },
        allergies: [{ type: String, trim: true }],
        chronicConditions: [{ type: String, trim: true }],
        disabilities: [{ type: String, trim: true }],
        organDonor: { type: Boolean, default: false },
        vaccinationRecord: { type: mongoose.Schema.Types.Mixed },
        pregnancyStatus: { type: mongoose.Schema.Types.Mixed }
    },
    { _id: false }
);

const vitalsSchema = new mongoose.Schema(
    {},
    { _id: false, strict: false }
);

const prescriptionSchema = new mongoose.Schema(
    {
        medicine: { type: String, trim: true },
        dosage: { type: String, trim: true },
        frequency: { type: String, trim: true },
        duration: { type: String, trim: true },
        instructions: { type: String, trim: true }
    },
    { _id: false }
);

const labTestSchema = new mongoose.Schema(
    {
        testName: { type: String, trim: true },
        reportId: { type: String, trim: true },
        result: { type: mongoose.Schema.Types.Mixed },
        referenceRange: { type: mongoose.Schema.Types.Mixed },
        impression: { type: String, trim: true },
        performedBy: { type: String, trim: true },
        date: { type: String, trim: true },
        status: { type: String, trim: true },
        reportUrl: { type: String, trim: true }
    },
    { _id: false }
);

const consultationSchema = new mongoose.Schema(
    {
        consultationId: { type: String, trim: true },
        date: { type: String, trim: true },
        doctorName: { type: String, trim: true },
        doctorId: { type: String, trim: true },
        facility: { type: String, trim: true },
        type: { type: String, trim: true },
        chiefComplaint: { type: String, trim: true },
        diagnosis: [{ type: String, trim: true }],
        vitals: { type: vitalsSchema },
        prescriptions: [prescriptionSchema],
        labTests: [labTestSchema],
        followUpDate: { type: String, trim: true },
        notes: { type: String, trim: true }
    },
    { _id: false }
);

const insuranceSchema = new mongoose.Schema(
    {
        ayushmanBharat: { type: Boolean, default: false },
        policyNumber: { type: String, trim: true },
        validTill: { type: String, trim: true }
    },
    { _id: false }
);

const ashaWorkerSchema = new mongoose.Schema(
    {
        name: { type: String, trim: true },
        contact: { type: String, trim: true },
        village: { type: String, trim: true }
    },
    { _id: false }
);

const patientSchema = new mongoose.Schema(
    {
        abha_profile: { type: abhaProfileSchema, required: true },
        address: { type: addressSchema },
        health_records: { type: healthRecordsSchema },
        consultations: [consultationSchema],
        insurance: { type: insuranceSchema },
        ashaWorker: { type: ashaWorkerSchema },
        ashaWorkerId: { type: mongoose.Schema.Types.ObjectId, ref: 'AshaWorkerAccount' },
        ashaWorkerAssignedAt: { type: Date },
        locationCoordinates: {
            latitude: { type: Number },
            longitude: { type: Number }
        }
    },
    {
        timestamps: true
    }
);

patientSchema.index({ 'abha_profile.healthIdNumber': 1 }, { unique: true });

const Patient = mongoose.model('PatientData', patientSchema, 'patients_data');

export default Patient;
