import mongoose from 'mongoose';
import bcrypt from 'bcrypt';

const userSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
        },
        email: {
            type: String,
            required: true,
            unique: true,
            lowercase: true,
            trim: true,
        },
        username: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
        },
        password: {
            type: String,
            required: true,
        },
        role: {
            type: String,
            trim: true,
            default: '',
        },
        organization: {
            type: String,
            trim: true,
            default: '',
        },
        department: {
            type: String,
            trim: true,
            default: '',
        },
        location: {
            type: String,
            trim: true,
            default: '',
        },
        bio: {
            type: String,
            trim: true,
            default: '',
        },
        skills: {
            type: [String],
            default: [],
        },
        interests: {
            type: [String],
            default: [],
        },
        goals: {
            type: [String],
            default: [],
        },
        socialLinks: {
            github: {
                type: String,
                trim: true,
                default: '',
            },
            linkedin: {
                type: String,
                trim: true,
                default: '',
            },
            portfolio: {
                type: String,
                trim: true,
                default: '',
            },
        },
        graphSeeds: {
            roles: {
                type: [String],
                default: [],
            },
            organizations: {
                type: [String],
                default: [],
            },
            departments: {
                type: [String],
                default: [],
            },
            locations: {
                type: [String],
                default: [],
            },
            skills: {
                type: [String],
                default: [],
            },
            interests: {
                type: [String],
                default: [],
            },
            goals: {
                type: [String],
                default: [],
            },
        },
    },
    {
        timestamps: true,
    }
);

// Hash password before saving
userSchema.pre('save', async function () {
    if (!this.isModified('password')) return;

    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
});

// Match user entered password to hashed password in database
userSchema.methods.matchPassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

// Exclude password when converting to JSON
userSchema.set('toJSON', {
    transform: (doc, ret) => {
        delete ret.password;
        return ret;
    }
});

const User = mongoose.model('User', userSchema);

export default User;
