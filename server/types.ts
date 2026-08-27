import { Request } from 'express';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: 'admin' | 'user';
  tenantId: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  correlationId?: string;
}
