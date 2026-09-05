/* Repository selection keeps credential-free JSON demos and multi-instance Firestore deployments behind one interface. Choose by configuration, not by branching in payment logic. */
import { join } from 'node:path';
import { JsonRepository } from './repository.mjs';

export async function createRepository({ backend, dataDir, environment = 'sandbox', projectId } = {}) {
  if (backend !== 'firestore') {
    return { repository: new JsonRepository(join(dataDir, 'neon-store.json')), backend: 'json' };
  }
  /* Dynamic import avoids loading the Firestore SDK for local JSON use and tests; it never enters the browser bundle. */
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore(projectId ? { projectId } : {});
  const { FirestoreRepository } = await import('./firestore-repository.mjs');
  return { repository: new FirestoreRepository(db, { namespace: environment }), backend: 'firestore' };
}
