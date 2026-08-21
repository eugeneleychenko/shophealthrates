# LeoSource Datapass Endpoint (for QuinStreet clicks team)

Per-click consumer data push. POST one JSON record per click as soon as the click key is generated; the consumer's form at shophealthrates.com/quick-quote.html is prefilled from it when they arrive.

## Endpoint

```
POST https://shophealthrates.com/api/qs-datapass
Content-Type: application/json
X-Datapass-Token: <token sent separately>
```

(`Authorization: Bearer <token>` is also accepted.)

## Request body (our preferred flat schema)

```json
{
  "clickKey": "fe035bd1141ca94c98da12c4603162d1",
  "firstName": "John",
  "lastName": "Doe",
  "email": "jdoe@example.com",
  "phone": "6505551234",
  "address": "234 Lazy Ave",
  "address2": "",
  "city": "San Mateo",
  "stateCode": "CA",
  "zip": "94404",
  "dob": "1981-11-11",
  "gender": "Male",
  "householdSize": 4,
  "householdIncome": 75000,
  "source": "<publisher id, same value as $source$>",
  "var1": "<publisher subid, same as $var1$>",
  "var2": ""
}
```

- `clickKey` is the only required field; it must match the `$clickkey$` value in the click-through URL. Everything else is optional: send what you have.
- `dob` as `YYYY-MM-DD` (or `MM/DD/YYYY`). `phone` digits only or formatted, either works. `gender` Male/Female. `householdIncome` numeric annual income.
- Key names are case-insensitive. If it is easier on your side, you can instead send the same structure your Prefill API returns (`{ "clickKey": "...", "DataPassData": { "Contact": {...}, "Individuals": [...] } }`) and we map it.
- One record per POST. Re-posting the same clickKey overwrites the previous record. Records are kept 48 hours.

## Responses

| Status | Body | Meaning |
|---|---|---|
| 200 | `{"status":"success","clickKey":"fe03...","fieldsReceived":10,"ttlSeconds":172800}` | stored |
| 400 | `{"status":"error","message":"clickKey required ..."}` | bad JSON or missing/invalid clickKey |
| 401 | `{"status":"error","message":"unauthorized"}` | missing or wrong token |
| 503 | `{"status":"error","message":"store unavailable, retry"}` | transient, please retry |

## Sample

```bash
curl -X POST https://shophealthrates.com/api/qs-datapass \
  -H "Content-Type: application/json" \
  -H "X-Datapass-Token: <token>" \
  -d '{"clickKey":"fe035bd1141ca94c98da12c4603162d1","firstName":"John","lastName":"Doe","email":"jdoe@example.com","phone":"6505551234","address":"234 Lazy Ave","city":"San Mateo","stateCode":"CA","zip":"94404","dob":"1981-11-11","gender":"Male","householdSize":4,"householdIncome":75000,"source":"12345","var1":"subA"}'
```

Same endpoint and token for staging and production testing on our side; point your staging environment at it directly.
