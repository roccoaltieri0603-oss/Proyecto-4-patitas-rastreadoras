import { ApiError, pedir } from "./client";

export { ApiError } from "./client";

export interface UsuarioAutenticado {
  id: string;
  username: string;
  onboardingCompleted: boolean;
}

function body(username: string, password: string): BodyInit {
  return JSON.stringify({ username, password });
}

export async function register(username: string, password: string): Promise<UsuarioAutenticado> {
  return (await pedir<{ user: UsuarioAutenticado }>("/api/auth/register", {
    method: "POST", body: body(username, password),
  })).user;
}

export async function login(username: string, password: string): Promise<UsuarioAutenticado> {
  return (await pedir<{ user: UsuarioAutenticado }>("/api/auth/login", {
    method: "POST", body: body(username, password),
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
