import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import Patient from '../models/Patient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);
const nonFlagArg = args.find((arg) => !arg.startsWith('--'));
const dataPathArg = process.env.DATA_PATH || nonFlagArg;

const defaultDataPath = path.resolve(__dirname, '..', 'data', 'abha_dummy_dataset.json');
const dataPath = dataPathArg ? path.resolve(dataPathArg) : defaultDataPath;

const TOWN_COORDS = {
    Nabha: { latitude: 30.3758, longitude: 76.1529 },
    'Nabha Town': { latitude: 30.3758, longitude: 76.1529 },
    Chhajli: { latitude: 30.0367, longitude: 75.8242 },
    Dhuri: { latitude: 30.3725, longitude: 75.8619 },
    'Dhuri Kalan': { latitude: 30.3725, longitude: 75.8619 },
    'Fatehgarh Churian': { latitude: 31.8643, longitude: 74.9567 },
    Ghanaur: { latitude: 30.3313, longitude: 76.612 },
    Rajpura: { latitude: 30.484, longitude: 76.594 },
    Sirhind: { latitude: 30.616, longitude: 76.3811 }
};

const PLACE_TO_TOWN = {
    'Barnala Khurd': 'Nabha',
    Nabha: 'Nabha',
    Patiala: 'Nabha',
    Punjab: 'Nabha',
    'Majra Khurd': 'Nabha',
    Chhajli: 'Chhajli',
    'Dhuri Kalan': 'Dhuri',
    Sadhuana: 'Nabha',
    'Fatehgarh Churian': 'Fatehgarh Churian',
    'Nabha Town': 'Nabha',
    'Bhamian Kalan': 'Nabha',
    Kohar: 'Nabha',
    'Tibba Sultanpur': 'Nabha',
    Ghanaur: 'Ghanaur',
    'Rajpura Road Village': 'Rajpura',
    'Sirhind Road Dhakoli': 'Sirhind'
};

const resolveTownCoordinates = (address) => {
    const candidates = [address?.village, address?.subDistrict, address?.district];
    for (const candidate of candidates) {
        if (!candidate) continue;
        const town = PLACE_TO_TOWN[candidate] || candidate;
        if (TOWN_COORDS[town]) {
            return { town, coords: TOWN_COORDS[town] };
        }
    }
    return { town: 'Nabha', coords: TOWN_COORDS.Nabha };
};

const loadData = () => {
    const raw = fs.readFileSync(dataPath, 'utf-8');
    return JSON.parse(raw);
};

const seed = async () => {
    await connectDB();

    const { patients = [] } = loadData();

    if (!Array.isArray(patients)) {
        throw new Error('Invalid dataset format. Expected { patients: [] }.');
    }

    const patientOps = patients
        .map((patient) => {
            const healthIdNumber = patient?.abha_profile?.healthIdNumber;
            if (!healthIdNumber) return null;
            const updatePayload = {
                abha_profile: patient.abha_profile,
                address: patient.address,
                health_records: patient.health_records,
                consultations: patient.consultations,
                insurance: patient.insurance,
                locationCoordinates:
                    patient.locationCoordinates ||
                    resolveTownCoordinates(patient.address || {}).coords
            };
            Object.keys(updatePayload).forEach((key) => {
                if (typeof updatePayload[key] === 'undefined') {
                    delete updatePayload[key];
                }
            });
            return {
                updateOne: {
                    filter: { 'abha_profile.healthIdNumber': healthIdNumber },
                    update: {
                        $set: updatePayload
                    },
                    upsert: true
                }
            };
        })
        .filter(Boolean);

    if (patientOps.length === 0) {
        console.log('No valid patient records found to update.');
        return;
    }

    const result = await Patient.bulkWrite(patientOps, { ordered: false });

    console.log(`Matched patients: ${result.matchedCount}`);
    console.log(`Modified patients: ${result.modifiedCount}`);
    console.log(`Upserted patients: ${result.upsertedCount}`);
};

seed()
    .catch((error) => {
        console.error('Seed failed:', error.message);
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
