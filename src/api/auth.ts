import { ApiError, pedir } from "./client";

export { ApiError } from "./client";

export interface UsuarioAutenticado {
  id: string;
  email: string;
  username: string;
  onboardingCompleted: boolean;
}

export async function register(email: string, username: string, password: string): Promise<UsuarioAutenticado> {
  return (await pedir<{ user: UsuarioAutenticado }>("/api/auth/register", {
    method: "POST", body: JSON.stringify({ email, username, password }),
  })).user;
}

export async function login(email: string, password: string): Promise<UsuarioAutenticado> {
  return (await pedir<{ user: UsuarioAutenticado }>("/api/auth/login", {
    method: "POST", body: JSON.stringify({ email, password }),
  })).user;
}

export async function logout(): Promise<void> {
  await pedir<void>("/api/auth/logout", { method: "POST" });
}

export async function getCurrentUser(): Promise<UsuarioAutenticado | null> {
  try {
    return (await pedir<{ user: UsuarioAutenticado }>("/api/auth/me")).user;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
