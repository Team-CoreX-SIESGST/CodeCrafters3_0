"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, LogOut, User } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";

const navLinks = ["Problem", "Features", "How It Works", "Demo"];

const Navbar = () => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef(null);
  const { user, isLoading, logout } = useAuth();
  const userAvatar = user?.profileImageUrl || user?.avatarUrl || null;
  const userName = user?.name || user?.username || user?.email || "Profile";
  const userInitial = userName.charAt(0).toUpperCase();
  const userEmail = user?.email || "";

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (profileRef.current && !profileRef.current.contains(event.target)) {
        setProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <nav
      className="fixed top-0 left-0 right-0 z-50 border-b border-border"
      style={{
        backdropFilter: "blur(12px)",
        background: "color-mix(in srgb, var(--background) 82%, transparent)",
      }}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        {/* Logo */}
        <div className="flex items-center gap-2">
          <img
            src="/main-logo.png"
            alt="NeuroTrace logo"
            className="h-8 w-8 rounded-md"
          />
          <span className="font-serif text-lg text-foreground font-semibold tracking-tight">
            NeuroTrace
          </span>
        </div>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center gap-8">
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(/\s/g, "-")}`}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link}
            </a>
          ))}
          <a href="#about" className="text-sm text-muted-foreground transition-colors hover:text-foreground">
            About
          </a>
        </div>

        {/* CTA / Auth */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="#demo"
            className="btn-primary !py-2 !px-5 text-sm animate-glow-pulse"
          >
            See It in Action
          </a>

          {!isLoading && (
            user ? (
              <div className="relative" ref={profileRef}>
                <button
                  type="button"
                  aria-label="Open profile menu"
                  title={userName}
                  onClick={() => setProfileOpen((open) => !open)}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-border bg-muted/70 px-2 text-foreground transition-colors hover:bg-muted"
                >
                  <span className="inline-flex h-8 w-8 items-center justify-center overflow-hidden rounded-full bg-muted">
                    {userAvatar ? (
                      <img
                        src={userAvatar}
                        alt={userName}
                        className="h-full w-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : userInitial ? (
                      <span className="text-sm font-semibold">{userInitial}</span>
                    ) : (
                      <User className="h-4 w-4" />
                    )}
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${profileOpen ? "rotate-180" : ""}`}
                  />
                </button>

                {profileOpen && (
                  <div className="absolute right-0 top-full mt-2 w-56 overflow-hidden rounded-2xl border border-border bg-background/95 shadow-lg backdrop-blur">
                    <div className="border-b border-border px-4 py-3">
                      <p className="text-sm font-semibold text-foreground">{userName}</p>
                      <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setProfileOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2 px-4 py-3 text-sm text-foreground transition-colors hover:bg-muted"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Logout</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full border border-border px-5 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Login
              </Link>
            )
          )}
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-foreground"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {mobileOpen ? (
              <path d="M6 6l12 12M6 18L18 6" />
            ) : (
              <path d="M3 6h18M3 12h18M3 18h18" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="md:hidden border-t border-border px-6 py-4 flex flex-col gap-4"
          style={{ background: "color-mix(in srgb, var(--background) 94%, transparent)" }}
        >
          {navLinks.map((link) => (
            <a
              key={link}
              href={`#${link.toLowerCase().replace(/\s/g, "-")}`}
              className="text-sm text-muted-foreground"
              onClick={() => setMobileOpen(false)}
            >
              {link}
            </a>
          ))}
          <a href="#about" className="text-sm text-muted-foreground" onClick={() => setMobileOpen(false)}>
            About
          </a>
          <a href="#demo" className="btn-primary !py-2 !px-5 text-sm text-center">
            See It in Action
          </a>
          {!isLoading && (
            user ? (
              <div className="rounded-2xl border border-border">
                <div className="flex items-center gap-3 px-4 py-3">
                  {userAvatar ? (
                    <img
                      src={userAvatar}
                      alt={userName}
                      className="h-8 w-8 rounded-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-semibold text-foreground">
                      {userInitial || <User className="h-4 w-4" />}
                    </span>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{userName}</p>
                    <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMobileOpen(false);
                    logout();
                  }}
                  className="flex w-full items-center justify-center gap-2 border-t border-border px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Logout</span>
                </button>
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-full border border-border px-4 py-2 text-center text-sm font-medium text-foreground transition-colors hover:bg-muted"
                onClick={() => setMobileOpen(false)}
              >
                Login
              </Link>
            )
          )}
        </div>
      )}
    </nav>
  );
};

export default Navbar;
