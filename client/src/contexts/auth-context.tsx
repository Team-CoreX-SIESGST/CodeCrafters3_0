"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useMemo,
  useCallback,
  ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { SERVER_URL } from "@/utils/commonHelper";

type User = {
  email: string;
  role?: string;
  name?: string;
  username?: string;
  organization?: string;
  department?: string;
  location?: string;
  bio?: string;
  skills?: string[];
  interests?: string[];
  goals?: string[];
  socialLinks?: {
    github?: string;
    linkedin?: string;
    portfolio?: string;
  };
  profileImageUrl?: string;
  avatarUrl?: string;
  graphSeeds?: {
    roles?: string[];
    organizations?: string[];
    departments?: string[];
    locations?: string[];
    skills?: string[];
    interests?: string[];
    goals?: string[];
  };
};

type AuthContextType = {
  user: User | null;
  token: string | null;
  login: (
    email: string,
    password: string,
  ) => Promise<{ success: boolean; error?: string }>;
  loginWithGoogle: (
    code: string,
  ) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  isLoading: boolean;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  const handleAuthSuccess = useCallback(
    (loggedInUser: User | null | undefined, jwt: string | null | undefined) => {
      if (loggedInUser) {
        localStorage.setItem("user", JSON.stringify(loggedInUser));
        setUser(loggedInUser);
      }
      if (jwt) {
        localStorage.setItem("token", jwt);
        setToken(jwt);
      }
      router.push("/chat");
    },
    [router],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      try {
        const apiUrl = SERVER_URL;

        const response = await fetch(`${apiUrl}/api/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ email, password }),
        });

        const data = await response.json();

        if (response.ok) {
          const loggedInUser = data?.data?.user || data?.user;
          const jwt = data?.token || null;
          handleAuthSuccess(loggedInUser, jwt);
          return { success: true };
        } else {
          toast.error("Login Failed", {
            description:
              data.message || data.error || "Invalid email or password",
          });
          return { success: false, error: data.message || "Login failed" };
        }
      } catch (error) {
        console.error("Login error:", error);
        toast.error("Error", {
          description: "An error occurred during login. Please try again.",
        });
        return { success: false, error: "An error occurred during login" };
      }
    },
    [handleAuthSuccess],
  );

  const loginWithGoogle = useCallback(
    async (code: string) => {
      try {
        const apiUrl = SERVER_URL;
        const response = await fetch(`${apiUrl}/api/users/google`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          credentials: "include",
          body: JSON.stringify({ code }),
        });

        const data = await response.json();

        if (response.ok) {
          const loggedInUser = data?.data?.user || data?.user;
          const jwt = data?.token || null;
          handleAuthSuccess(loggedInUser, jwt);
          return { success: true };
        }

        toast.error("Google Login Failed", {
          description:
            data.message || data.error || "Unable to sign in with Google",
        });
        return { success: false, error: data.message || "Google login failed" };
      } catch (error) {
        console.error("Google login error:", error);
        toast.error("Error", {
          description:
            "An error occurred during Google login. Please try again.",
        });
        return {
          success: false,
          error: "An error occurred during Google login",
        };
      }
    },
    [handleAuthSuccess],
  );

  const logout = useCallback(() => {
    localStorage.removeItem("user");
    localStorage.removeItem("token");
    setUser(null);
    setToken(null);
    router.push("/login");
  }, [router]);

  useEffect(() => {
    // Check if user is logged in on initial load
    const checkAuth = () => {
      try {
        const userData = localStorage.getItem("user");
        const storedToken = localStorage.getItem("token");
        if (userData) {
          setUser(JSON.parse(userData));
        }
        if (storedToken) {
          setToken(storedToken);
        }
      } catch (error) {
        console.error("Failed to parse user data from localStorage", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuth();
  }, []);

  const value = useMemo(
    () => ({
      user,
      token,
      login,
      loginWithGoogle,
      logout,
      isLoading,
    }),
    [user, token, isLoading, login, loginWithGoogle, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
