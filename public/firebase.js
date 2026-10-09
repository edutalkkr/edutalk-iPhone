/* Breeze Firebase client config
 * 아래 값은 Firebase '웹 앱'의 공개 식별자입니다(비밀 키가 아님). 정적 호스팅에는 빌드 단계가 없어
 * .env 를 주입할 수 없으므로 클라이언트에 그대로 둡니다.
 * 실제 보안 경계는 ① firestore.rules 의 접근 제어, ② Firebase Console 에서 이 API 키에 걸어 둔
 * HTTP referrer / 앱 제한입니다. 서비스 계정 키·토큰 같은 진짜 비밀 값은 이 파일에 두지 마세요.
 */
const firebaseConfig = {
  apiKey: "AIzaSyANLtEoKpVlu8iwt2gTFtBHiMMVsiE2Tbs",
  authDomain: "school-chat-9e69f.firebaseapp.com",
  projectId: "school-chat-9e69f",
  storageBucket: "school-chat-9e69f.firebasestorage.app",
  messagingSenderId: "232658683503",
  appId: "1:232658683503:web:8512328585ad0ed201af9a",
  measurementId: "G-5LYKZKYENB"
};

firebase.initializeApp(firebaseConfig);
window.EduFirebase = {
  firebase,
  auth: firebase.auth(),
  db: firebase.firestore(),
  config: firebaseConfig
};
