import { Request } from 'express';

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: 'admin' | 'user';
  name?: string;
  picture?: string;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
  correlationId?: string;
}
