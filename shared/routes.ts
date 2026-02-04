import { z } from 'zod';
import { insertProfileSchema, insertJobSchema, insertApplicationSchema, insertReviewSchema, insertCompanyLocationSchema, insertTeamInviteSchema, profiles, jobs, applications, reviews, companyLocations, teamInvites } from './schema';

// Helper function to transform date strings to Date objects
const transformProfileDates = (data: any) => {
  const result: any = { ...data };
  // Convert date strings to Date objects for timestamp fields
  if (typeof result.contractSignedAt === 'string') {
    result.contractSignedAt = new Date(result.contractSignedAt);
  }
  if (typeof result.faceVerifiedAt === 'string') {
    result.faceVerifiedAt = new Date(result.faceVerifiedAt);
  }
  if (typeof result.insuranceStartDate === 'string') {
    result.insuranceStartDate = new Date(result.insuranceStartDate);
  }
  if (typeof result.insuranceEndDate === 'string') {
    result.insuranceEndDate = new Date(result.insuranceEndDate);
  }
  if (typeof result.w9UploadedAt === 'string') {
    result.w9UploadedAt = new Date(result.w9UploadedAt);
  }
  return result;
};

// Schema for profile create with date transformation
const profileCreateSchema = insertProfileSchema.transform(transformProfileDates);

// Schema for profile update with date transformation
const profileUpdateSchema = insertProfileSchema.partial().transform(transformProfileDates);

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
  unauthorized: z.object({
    message: z.string(),
  }),
};

export const api = {
  profiles: {
    get: {
      method: 'GET' as const,
      path: '/api/profiles/:userId',
      responses: {
        // 200 with null when user has no profile yet (e.g. onboarding); avoids 404 in console
        200: z.union([z.custom<typeof profiles.$inferSelect>(), z.null()]),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/profiles',
      input: profileCreateSchema,
      responses: {
        201: z.custom<typeof profiles.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/profiles/:id',
      input: profileUpdateSchema,
      responses: {
        200: z.custom<typeof profiles.$inferSelect>(),
        400: errorSchemas.validation,
        404: errorSchemas.notFound,
      },
    },
  },
  jobs: {
    list: {
      method: 'GET' as const,
      path: '/api/jobs',
      input: z.object({
        trade: z.string().optional(),
        location: z.string().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof jobs.$inferSelect & { companyName: string | null }>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/jobs/:id',
      responses: {
        200: z.custom<typeof jobs.$inferSelect & { company: typeof profiles.$inferSelect }>(),
        404: errorSchemas.notFound,
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/jobs',
      input: insertJobSchema.omit({ companyId: true }), // companyId inferred from session
      responses: {
        201: z.custom<typeof jobs.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/jobs/:id/status',
      input: z.object({ status: z.enum(['open', 'in_progress', 'completed', 'cancelled']) }),
      responses: {
        200: z.custom<typeof jobs.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  applications: {
    create: {
      method: 'POST' as const,
      path: '/api/applications',
      input: z.object({ 
        jobId: z.number(), 
        message: z.string().optional(),
        proposedRate: z.number().optional(),
        teamMemberId: z.number().nullable().optional(),
      }),
      responses: {
        201: z.custom<typeof applications.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    listByJob: {
      method: 'GET' as const,
      path: '/api/jobs/:jobId/applications',
      responses: {
        200: z.array(z.custom<typeof applications.$inferSelect & { worker: typeof profiles.$inferSelect }>()),
      },
    },
    updateStatus: {
      method: 'PATCH' as const,
      path: '/api/applications/:id/status',
      input: z.object({ 
        status: z.enum(['pending', 'accepted', 'rejected']),
        rejectionReason: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof applications.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
  },
  companyLocations: {
    list: {
      method: 'GET' as const,
      path: '/api/company-locations',
      responses: {
        200: z.array(z.custom<typeof companyLocations.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/company-locations',
      input: insertCompanyLocationSchema.omit({ profileId: true }),
      responses: {
        201: z.custom<typeof companyLocations.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    update: {
      method: 'PUT' as const,
      path: '/api/company-locations/:id',
      input: insertCompanyLocationSchema.partial(),
      responses: {
        200: z.custom<typeof companyLocations.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/company-locations/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        404: errorSchemas.notFound,
      },
    },
  },
  teamInvites: {
    list: {
      method: 'GET' as const,
      path: '/api/team-invites',
      responses: {
        200: z.array(z.custom<typeof teamInvites.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/team-invites',
      input: z.object({ 
        email: z.string().email(), 
        role: z.enum(["admin", "manager", "viewer"]).optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        phone: z.string().optional(),
        jobPosition: z.string().optional(),
        locationIds: z.array(z.string()).optional(),
      }),
      responses: {
        201: z.custom<typeof teamInvites.$inferSelect>(),
        400: errorSchemas.validation,
        401: errorSchemas.unauthorized,
      },
    },
    delete: {
      method: 'DELETE' as const,
      path: '/api/team-invites/:id',
      responses: {
        200: z.object({ success: z.boolean() }),
        404: errorSchemas.notFound,
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
