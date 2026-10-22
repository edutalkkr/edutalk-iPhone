# 이용권 주문·결제 연동

이 문서는 브리즈 학교 이용권의 주문, 결제 확인, 이용권 발급, 영수증 흐름을 설명합니다. 결제 금액과 이용권 발급은 서버에서만 결정하며, 클라이언트는 화면과 요청만 담당합니다.

## 1. 요금제와 금액

요금제의 단일 기준은 `functions/billing-core.js`의 `PLAN_DEFINITIONS`입니다. 표시 금액은 부가세 포함 금액이며, 공급가액과 부가세는 다음 기준으로 계산합니다.

- 공급가액 = 합계 ÷ 1.1 (원 단위 반올림)
- 부가세 = 합계 - 공급가액

| 요금제 ID | 이름 | 금액(부가세 포함) | 기간 | 망 |
| --- | --- | ---: | --- | --- |
| `single_chat_1y` | 소통 전용 1년 | 99,000원 | 365일 | 단일 |
| `single_1y` | 기본 1년 | 198,000원 | 365일 | 단일 |
| `dual_chat_1y` | 듀얼 소통 전용 1년 | 198,000원 | 365일 | 듀얼 |
| `dual_unified_1y` | 듀얼 1년 | 297,000원 | 365일 | 듀얼 |

가격을 바꿀 때는 서버의 `PLAN_DEFINITIONS`만 수정합니다. 공개 웹과 관리자 화면은 `getBillingPlans`가 돌려준 값을 그립니다.

## 2. 결제 모드

`PAYMENT_MODE` 환경 변수로 결제 경로를 고릅니다.

| 모드 | 동작 | 사용 시점 |
| --- | --- | --- |
| `manual` (기본값) | 무통장 입금 주문을 만들고, 총관리자가 입금을 확인한 뒤 이용권을 발급 | 사업자등록·결제대행사 계약 전 |
| `sandbox` | 카드 결제 화면을 실제 청구 없이 확인하고, 확인 버튼으로 이용권을 발급 | 내부 시연·화면 검수 |
| `live` | 서버가 결제 창 URL을 돌려주고, 결제대행사 웹훅이 확인되면 이용권을 발급 | 실제 판매 |

> `sandbox`는 결제 확인 버튼만으로 이용권이 발급됩니다. 운영 환경에서는 반드시 `manual` 또는 `live`를 사용합니다.

## 3. 환경 변수

`functions/.env.example`을 참고해 Firebase Functions 환경 변수로 등록합니다.

```dotenv
PAYMENT_MODE=manual
BILLING_BANK_NAME=
BILLING_ACCOUNT_NUMBER=
BILLING_ACCOUNT_HOLDER=
BILLING_TRANSFER_GUIDE=입금자명을 학교명으로 남겨 주세요.
BILLING_DEPOSIT_DUE_HOURS=72

# live 모드
BILLING_CHECKOUT_URL=https://checkout.example.com/session
PAYMENT_WEBHOOK_SECRET=
```

- `BILLING_CHECKOUT_URL`은 HTTPS만 허용합니다. `orderId`, `orderNo`, `amount`, `plan`이 쿼리로 자동 추가됩니다.
- `PAYMENT_WEBHOOK_SECRET`은 웹훅 본문을 HMAC-SHA256으로 서명할 때 사용하는 키입니다.
- 계좌 정보가 비어 있어도 주문은 만들 수 있습니다. 이 경우 화면에 "입금 계좌는 결제 담당자가 안내해 드려요."가 표시되고, 총관리자가 직접 안내·확인합니다.

## 4. 주문 흐름

1. 학교 관리자 또는 총관리자가 `getBillingPlans`로 요금제·결제 방법·계좌 정보를 받습니다.
2. `createLicenseOrder`에 요금제 ID, 결제 방법, 구매자 이름, 학교 이름, 동의 여부, 멱등 키를 보냅니다.
3. 서버가 요금제와 결제 방법을 검증하고 금액을 계산한 뒤 `licenseOrders/{orderId}`를 만듭니다.
4. 무통장 입금은 입금 기한과 계좌를 안내합니다. 카드 `sandbox`는 화면에서 확인을 누르면 `confirmLicenseOrder`가 발급합니다. 카드 `live`는 결제 창으로 이동합니다.
5. 결제가 확인되면 `licenses/{16자리코드}`가 발급되고 주문 상태가 `paid`로 바뀝니다.
6. 학교 관리자는 이용권 등록 화면에서 고유코드와 인증코드를 입력해 이용을 시작합니다.
7. 구매자는 주문 상세에서 결제 확인서를 인쇄할 수 있습니다.

### 주문 상태

- `pending`: 결제 또는 입금 확인 대기
- `paid`: 결제 완료·이용권 발급 완료
- `cancelled`: 구매자 또는 총관리자가 취소
- `failed`: 결제 창 생성 실패 등으로 종료

## 5. 중복 발급 방지

- 클라이언트는 결제 시도마다 16자 이상의 멱등 키를 만들고, 네트워크 오류로 재시도할 때 같은 키를 다시 보냅니다.
- 서버는 `SHA-256(구매자 UID + 멱등 키)`의 앞 32자를 주문 문서 ID로 사용합니다.
- 주문 생성은 Firestore 트랜잭션으로 처리합니다. 동시에 같은 요청이 와도 문서는 하나만 생깁니다.
- `issueLicenseForOrder`는 주문이 이미 `paid`이면 기존 코드를 돌려주므로 웹훅이 여러 번 와도 이용권이 중복 발급되지 않습니다.
- 웹훅은 서명과 주문 금액이 모두 맞을 때만 발급합니다.

## 6. live 연동 시 확인 사항

1. 결제대행사에서 결제 세션을 만들 수 있는 HTTPS URL을 준비합니다. `BILLING_CHECKOUT_URL`에 그 주소를 넣습니다.
2. 결제 완료 웹훅을 `licensePaymentWebhook` 주소로 보냅니다.
3. 웹훅 본문은 다음 형태를 기준으로 합니다.

```json
{
  "id": "evt_123",
  "type": "payment.paid",
  "data": {
    "orderId": "주문 문서 ID",
    "amount": 198000,
    "transactionId": "결제사 거래 ID"
  }
}
```

4. 웹훅 요청 헤더의 `x-breeze-signature`에 본문 HMAC-SHA256(hex) 서명을 넣습니다. 결제대행사가 다른 서명 방식을 쓴다면 `licensePaymentWebhook` 안의 검증 부분만 어댑터로 교체합니다.
5. 결제 완료 후 구매자가 돌아올 주소를 결제대행사에 등록합니다. 브리즈는 결제 창을 연 뒤 `getLicenseOrder`로 상태를 확인하므로, 복귀 주소는 서비스 화면이면 충분합니다.
6. 실제 카드 승인·취소·부분 환불은 결제대행사 콘솔과 웹훅 이벤트 설계를 함께 맞춰야 합니다. 현재 구현은 `payment.paid`만 처리하며, 환불은 기존 환불 요청 흐름에서 수동으로 처리합니다.

## 7. 보안과 운영

- `licenseOrders`는 클라이언트가 직접 만들거나 수정할 수 없습니다. Functions의 Admin SDK만 씁니다.
- 주문 조회는 구매자 본인과 총관리자만 가능합니다.
- 서버는 요청 본문의 금액을 신뢰하지 않고 요금제 ID로 다시 계산합니다.
- 이용권 코드는 혼동하기 쉬운 문자(`I`, `O`, `0`, `1`)를 뺀 32자 알파벳에서 만듭니다.
- 인증코드는 주문 문서에 저장하지 않고 `licenses` 문서에만 저장합니다. 구매자는 본인 이용권 문서를 읽을 수 있습니다.
- `sandbox` 모드에서는 실제 카드 정보를 받지 않습니다.
- 운영 배포 전 `PAYMENT_MODE`가 `manual` 또는 `live`인지, `PAYMENT_WEBHOOK_SECRET`이 설정됐는지 확인합니다.

## 8. 검증

```bash
cd functions
npm run test:billing
```

테스트는 요금제·부가세 계산, 입력 검증, 결제 모드, 멱등 키 형식, 주문 번호·이용권 코드 형식, 웹훅 서명, 상태 전이를 확인합니다.
