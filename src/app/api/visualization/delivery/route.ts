import { createDeliveryGET } from '../../../../lib/visualization/delivery-handler';
import { openSession } from '../../../../lib/visualization/runtime';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = createDeliveryGET(openSession);
