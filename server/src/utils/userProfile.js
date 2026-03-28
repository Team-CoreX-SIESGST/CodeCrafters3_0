const toTrimmedString = (value, maxLength = 120) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

const normalizeList = (value, maxItems = 12, maxLength = 48) => {
  const raw =
    Array.isArray(value) && value.length
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];

  const seen = new Set();
  const cleaned = [];

  for (const item of raw) {
    const normalized = toTrimmedString(item, maxLength);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(normalized);
    if (cleaned.length >= maxItems) break;
  }

  return cleaned;
};

const normalizeUrl = (value) => {
  const trimmed = toTrimmedString(value, 240);
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
};

const buildGraphSeeds = ({
  role,
  organization,
  department,
  location,
  skills,
  interests,
  goals,
}) => ({
  roles: normalizeList(role ? [role] : [], 4, 64).map((item) =>
    item.toLowerCase(),
  ),
  organizations: normalizeList(
    organization ? [organization] : [],
    4,
    80,
  ).map((item) => item.toLowerCase()),
  departments: normalizeList(department ? [department] : [], 4, 64).map(
    (item) => item.toLowerCase(),
  ),
  locations: normalizeList(location ? [location] : [], 4, 64).map((item) =>
    item.toLowerCase(),
  ),
  skills: normalizeList(skills).map((item) => item.toLowerCase()),
  interests: normalizeList(interests).map((item) => item.toLowerCase()),
  goals: normalizeList(goals, 12, 72).map((item) => item.toLowerCase()),
});

export const normalizeUserProfilePayload = (payload = {}) => {
  const name = toTrimmedString(payload.name, 80);
  const username = toTrimmedString(payload.username, 40);
  const role = toTrimmedString(payload.role, 80);
  const organization = toTrimmedString(payload.organization, 120);
  const department = toTrimmedString(payload.department, 80);
  const location = toTrimmedString(payload.location, 80);
  const bio = toTrimmedString(payload.bio, 280);
  const skills = normalizeList(payload.skills);
  const interests = normalizeList(payload.interests);
  const goals = normalizeList(payload.goals, 12, 72);

  return {
    name,
    username: username || undefined,
    email: toTrimmedString(payload.email, 160).toLowerCase(),
    password: payload.password,
    role,
    organization,
    department,
    location,
    bio,
    skills,
    interests,
    goals,
    socialLinks: {
      github: normalizeUrl(payload.githubUrl),
      linkedin: normalizeUrl(payload.linkedinUrl),
      portfolio: normalizeUrl(payload.portfolioUrl),
    },
    graphSeeds: buildGraphSeeds({
      role,
      organization,
      department,
      location,
      skills,
      interests,
      goals,
    }),
  };
};

export const serializeUser = (user) => ({
  _id: user._id,
  name: user.name,
  username: user.username || "",
  email: user.email,
  role: user.role || "",
  organization: user.organization || "",
  department: user.department || "",
  location: user.location || "",
  bio: user.bio || "",
  skills: Array.isArray(user.skills) ? user.skills : [],
  interests: Array.isArray(user.interests) ? user.interests : [],
  goals: Array.isArray(user.goals) ? user.goals : [],
  socialLinks: {
    github: user.socialLinks?.github || "",
    linkedin: user.socialLinks?.linkedin || "",
    portfolio: user.socialLinks?.portfolio || "",
  },
  graphSeeds: user.graphSeeds || {
    roles: [],
    organizations: [],
    departments: [],
    locations: [],
    skills: [],
    interests: [],
    goals: [],
  },
});
