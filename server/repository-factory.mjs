/* 저장소 선택. 두 구현을 모두 남겨 두는 이유가 있다.
 *
 * JsonRepository 는 "자격 증명 없이 clone 해서 바로 돌려본다"를 가능하게 하는
 * 유일한 경로다 — 의존성도, 에뮬레이터도, 클라우드 프로젝트도 필요 없다.
 * 그걸 잃으면 데모를 검토하는 사람이 먼저 GCP 계정을 만들어야 한다.
 *
 * FirestoreRepository 는 인스턴스가 여러 개일 때만 의미가 있다. 그래서 선택은
 * 환경이 하고, 코드는 어느 쪽인지 모른 채로 같은 메서드 다섯 개만 쓴다. */
import { join } from 'node:path';
import { JsonRepository } from './repository.mjs';

export async function createRepository({ backend, dataDir, environment = 'sandbox', projectId } = {}) {
  if (backend !== 'firestore') {
    return { repository: new JsonRepository(join(dataDir, 'neon-store.json')), backend: 'json' };
  }
  /* 동적 import — JSON 경로로 도는 로컬·테스트에서는 Firestore SDK 를 아예
   * 불러오지 않는다. 브라우저 번들과도 무관하다. */
  const { Firestore } = await import('@google-cloud/firestore');
  const db = new Firestore(projectId ? { projectId } : {});
  const { FirestoreRepository } = await import('./firestore-repository.mjs');
  return { repository: new FirestoreRepository(db, { namespace: environment }), backend: 'firestore' };
}
