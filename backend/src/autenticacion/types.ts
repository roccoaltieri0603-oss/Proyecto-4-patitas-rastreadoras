export interface Usuario {
  id: string;
  email: string;
  username: string;
  onboardingCompleted: boolean;
}

export interface JwtPayload {
  sub: string;
}
