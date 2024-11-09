import type { DefaultSession } from "next-auth";
import NextAuth from "next-auth";

import { analytics, trackAnalytics } from "@openstatus/analytics";
import { db, eq } from "@openstatus/db";
import { user } from "@openstatus/db/src/schema";
import { sendEmail } from "@openstatus/emails/emails/send";

import { identifyUser } from "@/providers/posthog";
import { WelcomeEmail } from "@openstatus/emails/emails/welcome";
import { adapter } from "./adapter";
import { GitHubProvider, GoogleProvider, ResendProvider } from "./providers";

export type { DefaultSession };

export const { handlers, signIn, signOut, auth } = NextAuth({
  // debug: true,
  adapter,
  providers:
    process.env.NODE_ENV === "development"
      ? [GitHubProvider, GoogleProvider, ResendProvider]
      : [GitHubProvider, GoogleProvider],
  callbacks: {
    async signIn(params) {
      // We keep updating the user info when we loggin in

      if (params.account?.provider === "google") {
        if (!params.profile) return true;
        if (Number.isNaN(Number(params.user.id))) return true;

        await db
          .update(user)
          .set({
            firstName: params.profile.given_name,
            lastName: params.profile.family_name,
            photoUrl: params.profile.picture,
            // keep the name in sync
            name: `${params.profile.given_name} ${params.profile.family_name}`,
            updatedAt: new Date(),
          })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }
      if (params.account?.provider === "github") {
        if (!params.profile) return true;
        if (Number.isNaN(Number(params.user.id))) return true;

        await db
          .update(user)
          .set({
            name: params.profile.name,
            photoUrl: String(params.profile.avatar_url),
            updatedAt: new Date(),
          })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }

      // REMINDER: only used in dev mode
      if (params.account?.provider === "resend") {
        await db
          .update(user)
          .set({ updatedAt: new Date() })
          .where(eq(user.id, Number(params.user.id)))
          .run();
      }

      return true;
    },
    async session(params) {
      return params.session;
    },
  },
  events: {
    // That should probably done in the callback method instead
    async createUser(params) {
      if (!params.user.id || !params.user.email) {
        throw new Error("User id & email is required");
      }

      // this means the user has already been created with clerk
      if (params.user.tenantId) return;

      await sendEmail({
        from: "Thibault Le Ouay Ducasse <thibault@openstatus.dev>",
        subject: "Welcome to OpenStatus.",
        to: [params.user.email],
        react: WelcomeEmail(),
      });

      const { id: userId, email } = params.user;

      if (process.env.NODE_ENV !== "development") {
        await analytics.identify(userId, { email, userId });
        await trackAnalytics({ event: "User Created", userId, email });
        await identifyUser({ user: params.user });
      }
    },

    async signIn(params) {
      if (params.isNewUser) return;
      if (!params.user.id || !params.user.email) return;

      const { id: userId, email } = params.user;

      if (process.env.NODE_ENV !== "development") {
        await analytics.identify(userId, { userId, email });
        await identifyUser({ user: params.user });
        await trackAnalytics({ event: "User Signed In" });
      }
    },
  },
  pages: {
    signIn: "/app/login",
    newUser: "/app/onboarding",
  },
  // basePath: "/api/auth", // default is `/api/auth`
  // secret: process.env.AUTH_SECRET, // default is `AUTH_SECRET`
});
