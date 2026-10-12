"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="state-page">
      <h1>Tempo couldn’t open this view.</h1>
      <p>Your saved work is still in your account.</p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
