import NextAuth, { NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { NextRequest } from 'next/server';

function getAuthOptions(req?: NextRequest): NextAuthOptions {
  return {
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      }),
    ],
    callbacks: {
      async signIn({ account, profile }) {
        if (account?.provider === 'google') {
          const googleProfile = profile as any;
          if (googleProfile && googleProfile.email_verified === false) {
            console.warn('[NextAuth Google] Sign-in rejected: email is not verified by Google');
            return false;
          }
        }
        return true;
      },
      async session({ session, token }) {
        if (session.user) {
          (session.user as any).id = token.sub;
        }
        return session;
      },
      async redirect({ url, baseUrl }) {
        if (url.startsWith('/')) return `${baseUrl}${url}`;
        else if (new URL(url).origin === baseUrl) return url;
        return baseUrl;
      },
    },
    pages: {
      signIn: '/',
      error: '/',
    },
    secret: process.env.NEXTAUTH_SECRET || 'insight_ai_secret_nextauth_jwt_key_2026_super_secure_random',
  };
}

async function authHandler(req: NextRequest, ctx: { params: { nextauth: string[] } }) {
  return NextAuth(req, ctx, getAuthOptions(req));
}

export { authHandler as GET, authHandler as POST };
