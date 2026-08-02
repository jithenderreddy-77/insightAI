'use client';

import React from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-white min-h-screen flex items-center justify-center p-6">
        <div className="max-w-md w-full p-6 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-4 shadow-2xl">
          <h2 className="text-xl font-black text-white">Application Error</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            {error.message || 'A critical error occurred. Please refresh the page.'}
          </p>
          <button
            onClick={() => reset()}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs"
          >
            Reset Application
          </button>
        </div>
      </body>
    </html>
  );
}
