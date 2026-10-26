import { createGET } from '../../../../lib/visualization/handler';
import { openSession } from '../../../../lib/visualization/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createGET(openSession);
