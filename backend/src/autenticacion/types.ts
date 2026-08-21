export interface Usuario {
  id: string;
  username: string;
  onboardingCompleted: boolean;
}

export interface JwtPayload {
  sub: string;
}
