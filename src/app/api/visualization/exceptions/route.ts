import { createExceptionsGET } from '../../../../lib/visualization/exceptions-handler';
import { openSession } from '../../../../lib/visualization/runtime';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=createExceptionsGET(openSession);
