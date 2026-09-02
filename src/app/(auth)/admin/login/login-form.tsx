"use client";

import { useActionState } from "react";
import { type SignInState, signInAction } from "./actions";

const initialState: SignInState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(signInAction, initialState);

  return (
    <form action={action}>
      <p>
        <label htmlFor="email">Email</label>
        <br />
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
        />
      </p>
      <p>
        <label htmlFor="password">Password</label>
        <br />
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
      </p>
      {state.error ? (
        <p role="alert" style={{ color: "#b00020" }}>
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending}>
        Sign in
      </button>
    </form>
  );
}
