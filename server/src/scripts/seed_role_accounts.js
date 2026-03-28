import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import connectDB from '../config/db.js';
import DoctorAccount from '../models/DoctorAccount.js';
import AshaWorkerAccount from '../models/AshaWorkerAccount.js';
import Patient from '../models/Patient.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const datasetPath = path.resolve(__dirname, '..', 'data', 'abha_dummy_dataset.json');

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

const defaultSlots = [
    '11:00 AM',
    '12:00 PM',
    '01:00 PM',
    '02:00 PM',
    '03:00 PM',
    '04:00 PM',
    '05:00 PM',
    '06:00 PM'
];

const doctorProfiles = [
    {
        name: 'Dr. Aditi Sharma',
        username: 'dr.aditi',
        hospitalName: 'Nabha CHC',
        phoneNumber:"9321858873",
        specialization: 'Family Medicine',
        qualification: 'MBBS, DNB (Family Medicine)',
        registrationId: 'PB-MCI-23001',
        experienceYears: 9,
        availability: '09:00 - 14:00',
        languages: ['Punjabi', 'Hindi', 'English'],
        about:
            'Focuses on preventive care, hypertension, diabetes screening, and community health awareness.'
    },
    {
        name: 'Dr. Rohan Mehta',
        username: 'dr.rohan',
        hospitalName: 'Nabha Civil Hospital',
        specialization: 'General Medicine',
        qualification: 'MBBS, MD (Internal Medicine)',
        registrationId: 'PB-MCI-23002',
        experienceYears: 12,
        availability: '10:00 - 16:00',
        languages: ['Hindi', 'English'],
        about:
            'Experienced in managing chronic conditions and tele-consultation follow-ups.'
    },
    {
        name: 'Dr. Kavya Rao',
        username: 'dr.kavya',
        hospitalName: 'Ghanaur PHC',
        specialization: 'Obstetrics & Gynecology',
        qualification: 'MBBS, DGO',
        registrationId: 'PB-MCI-23003',
        experienceYears: 8,
        availability: '08:30 - 13:30',
        languages: ['Punjabi', 'Hindi'],
        about:
            'Supports maternal health, antenatal care, and women wellness programs.'
    },
    {
        name: 'Dr. Arjun Reddy',
        username: 'dr.arjun',
        hospitalName: 'Rajpura SDH',
        specialization: 'Orthopedics',
        qualification: 'MBBS, MS (Ortho)',
        registrationId: 'PB-MCI-23004',
        experienceYears: 11,
        availability: '11:00 - 17:00',
        languages: ['Hindi', 'English', 'Telugu'],
        about:
            'Treats joint pains, sports injuries, and post-surgical rehabilitation.'
    },
    {
        name: 'Dr. Priya Iyer',
        username: 'dr.priya',
        hospitalName: 'Sirhind CHC',
        specialization: 'Pediatrics',
        qualification: 'MBBS, DCH',
        registrationId: 'PB-MCI-23005',
        experienceYears: 7,
        availability: '09:30 - 13:30',
        languages: ['Hindi', 'English', 'Tamil'],
        about:
            'Specializes in child wellness, vaccination guidance, and growth monitoring.'
    },
    {
        name: 'Dr. Sourav Banerjee',
        username: 'dr.sourav',
        hospitalName: 'Dhuri CHC',
        specialization: 'Dermatology',
        qualification: 'MBBS, MD (Dermatology)',
        registrationId: 'PB-MCI-23006',
        experienceYears: 10,
        availability: '12:00 - 18:00',
        languages: ['Hindi', 'English', 'Bengali'],
        about:
            'Manages skin allergies, infections, and long-term dermatological care.'
    },
    {
        name: 'Dr. Neha Kulkarni',
        username: 'dr.neha',
        hospitalName: 'Chhajli PHC',
        specialization: 'ENT',
        qualification: 'MBBS, MS (ENT)',
        registrationId: 'PB-MCI-23007',
        experienceYears: 6,
        availability: '09:00 - 13:00',
        languages: ['Hindi', 'English', 'Marathi'],
        about:
            'Handles ENT infections, allergy care, and minor procedures for rural patients.'
    },
    {
        name: 'Dr. Vishal Patel',
        username: 'dr.vishal',
        hospitalName: 'Fatehgarh Churian CHC',
        specialization: 'Cardiology',
        qualification: 'MBBS, MD (Cardiology)',
        registrationId: 'PB-MCI-23008',
        experienceYears: 14,
        availability: '10:30 - 15:30',
        languages: ['Hindi', 'English', 'Gujarati'],
        about:
            'Focuses on cardiac risk management, ECG review, and preventive heart care.'
    },
    {
        name: 'Dr. Ananya Singh',
        username: 'dr.ananya',
        hospitalName: 'Rajpura CHC',
        specialization: 'Psychiatry',
        qualification: 'MBBS, MD (Psychiatry)',
        registrationId: 'PB-MCI-23009',
        experienceYears: 9,
        availability: '11:30 - 16:30',
        languages: ['Hindi', 'English'],
        about:
            'Supports mental health counseling, stress management, and tele-psychiatry.'
    },
    {
        name: 'Dr. Rahul Verma',
        username: 'dr.rahul',
        hospitalName: 'Sirhind SDH',
        specialization: 'Pulmonology',
        qualification: 'MBBS, MD (Pulmonology)',
        registrationId: 'PB-MCI-23010',
        experienceYears: 13,
        availability: '09:00 - 15:00',
        languages: ['Hindi', 'English'],
        about:
            'Treats asthma, COPD, and respiratory infections with community outreach.'
    }
];

const doctorPhoneBase = 9876500000;

const ashaProfiles = [
    { name: 'Sunita Devi', username: 'asha.sunita' },
    { name: 'Meera Kumari', username: 'asha.meera' },
    { name: 'Latha R', username: 'asha.latha' },
    { name: 'Sangeeta Rao', username: 'asha.sangeeta' },
    { name: 'Revathi S', username: 'asha.revathi' },
    { name: 'Anita Das', username: 'asha.anita' },
    { name: 'Komal Patil', username: 'asha.komal' },
    { name: 'Bhavna Shah', username: 'asha.bhavna' },
    { name: 'Pooja Meena', username: 'asha.pooja' },
    { name: 'Ritu Singh', username: 'asha.ritu' }
];

const townSequence = [
    'Nabha',
    'Nabha',
    'Ghanaur',
    'Rajpura',
    'Sirhind',
    'Dhuri',
    'Chhajli',
    'Fatehgarh Churian',
    'Rajpura',
    'Sirhind'
];

const toRad = (value) => (value * Math.PI) / 180;
const toDeg = (value) => (value * 180) / Math.PI;

const offsetCoordinate = (latitude, longitude, distanceKm) => {
    const bearing = Math.random() * 360;
    const angularDistance = distanceKm / 6371;
    const lat1 = toRad(latitude);
    const lon1 = toRad(longitude);
    const bearingRad = toRad(bearing);

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(angularDistance) +
            Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearingRad)
    );
    const lon2 =
        lon1 +
        Math.atan2(
            Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(lat1),
            Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
        );

    return { latitude: Number(toDeg(lat2).toFixed(6)), longitude: Number(toDeg(lon2).toFixed(6)) };
};

const randomInRange = (min, max) => min + Math.random() * (max - min);

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

const seedAccounts = async () => {
    await connectDB();

    const raw = fs.readFileSync(datasetPath, 'utf-8');
    const data = JSON.parse(raw);
    const patients = Array.isArray(data.patients) ? data.patients : [];

    const patientOps = patients
        .map((patient) => {
            const healthIdNumber = patient?.abha_profile?.healthIdNumber;
            if (!healthIdNumber) return null;
            const { coords } = resolveTownCoordinates(patient.address || {});
            return {
                updateOne: {
                    filter: { 'abha_profile.healthIdNumber': healthIdNumber },
                    update: { $set: { locationCoordinates: coords } },
                    upsert: false
                }
            };
        })
        .filter(Boolean);

    if (patientOps.length > 0) {
        const patientResult = await Patient.bulkWrite(patientOps, { ordered: false });
        console.log(
            `Patients updated: matched ${patientResult.matchedCount}, modified ${patientResult.modifiedCount}`
        );
    }

    const doctorOps = [];
    for (let index = 0; index < doctorProfiles.length; index += 1) {
        const doctorProfile = doctorProfiles[index];
        const town = townSequence[index] || 'Nabha';
        const base = TOWN_COORDS[town] || TOWN_COORDS.Nabha;
        const locationCoordinates = offsetCoordinate(
            base.latitude,
            base.longitude,
            randomInRange(5, 10)
        );

        const doctor = {
            ...doctorProfile,
            password: 'Doctor@123',
            phoneNumber: String(doctorPhoneBase + index + 1),
            locationCoordinates,
            availableSlots: defaultSlots
        };

        doctorOps.push({
            updateOne: {
                filter: { username: doctor.username },
                update: {
                    $set: {
                        name: doctor.name,
                        hospitalName: doctor.hospitalName,
                        phoneNumber: doctor.phoneNumber,
                        specialization: doctor.specialization,
                        qualification: doctor.qualification,
                        registrationId: doctor.registrationId,
                        experienceYears: doctor.experienceYears,
                        about: doctor.about,
                        languages: doctor.languages,
                        availability: doctor.availability,
                        locationCoordinates: doctor.locationCoordinates,
                        availableSlots: doctor.availableSlots
                    },
                    $setOnInsert: { password: doctor.password, username: doctor.username }
                },
                upsert: true
            }
        });
    }

    const ashaOps = [];
    for (let index = 0; index < ashaProfiles.length; index += 1) {
        const ashaProfile = ashaProfiles[index];
        const town = townSequence[index] || 'Nabha';
        const base = TOWN_COORDS[town] || TOWN_COORDS.Nabha;
        const locationCoordinates = offsetCoordinate(
            base.latitude,
            base.longitude,
            randomInRange(5, 10)
        );

        const asha = {
            ...ashaProfile,
            password: 'Asha@123',
            locationCoordinates
        };

        ashaOps.push({
            updateOne: {
                filter: { username: asha.username },
                update: { $setOnInsert: asha },
                upsert: true
            }
        });
    }

    if (doctorOps.length > 0) {
        const doctorResult = await DoctorAccount.bulkWrite(doctorOps, { ordered: false });
        console.log(
            `Doctors upserted: ${doctorResult.upsertedCount}, matched: ${doctorResult.matchedCount}`
        );
    }

    if (ashaOps.length > 0) {
        const ashaResult = await AshaWorkerAccount.bulkWrite(ashaOps, { ordered: false });
        console.log(
            `ASHA upserted: ${ashaResult.upsertedCount}, matched: ${ashaResult.matchedCount}`
        );
    }
};

seedAccounts()
    .catch((error) => {
        console.error('Seed failed:', error.message);
    })
    .finally(async () => {
        await mongoose.connection.close();
    });
