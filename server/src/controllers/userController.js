import User from "../models/User.js";
import { signToken } from "../utils/jwt.js";
import { google } from "googleapis";
import crypto from "crypto";
import {
  normalizeUserProfilePayload,
  serializeUser,
} from "../utils/userProfile.js";

const generateToken = (id) => signToken({ id }, { expiresIn: "30d" });

// @desc    Google login/signup (simple)
// @route   POST /api/users/google
// @access  Public
export const googleAuth = async (req, res) => {
  try {
    const { code } = req.body || {};
    const profile = normalizeUserProfilePayload(req.body);

    let resolvedName = profile.name;
    let resolvedEmail = profile.email;
    let resolvedPassword = profile.password;
    
    if (code) {
      const clientId = process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
      if (!clientId || !clientSecret) {
        return res
          .status(500)
          .json({ message: "Google OAuth is not configured on the server" });
      }

      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        "postmessage",
      );

      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);
      const oauth2 = google.oauth2({ auth: oauth2Client, version: "v2" });
      const { data } = await oauth2.userinfo.get();
      resolvedName = resolvedName || data?.name || data?.given_name;
      resolvedEmail = resolvedEmail || data?.email;
      resolvedPassword =
        resolvedPassword || crypto.randomBytes(24).toString("hex");
    }

    if (!resolvedName || !resolvedEmail || !resolvedPassword) {
      return res
        .status(400)
        .json({ message: "Please provide name, email, and password" });
    }

    let user = await User.findOne({ email: resolvedEmail });

    if (!user) {
      const normalizedProfile = normalizeUserProfilePayload({
        ...req.body,
        name: resolvedName,
        email: resolvedEmail,
        password: resolvedPassword,
      });

      if (normalizedProfile.username) {
        const usernameExists = await User.findOne({
          username: normalizedProfile.username,
        });
        if (usernameExists) {
          return res.status(400).json({ message: "Username already exists" });
        }
      }

      user = await User.create({
        ...normalizedProfile,
      });
    }

    return res.status(200).json({
      user: serializeUser(user),
      token: generateToken(user._id),
    });
  } catch (error) {
    return res.status(500).json({ message: error.message });
  }
};
