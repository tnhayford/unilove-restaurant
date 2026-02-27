Verification
Last updated February 11th, 2026

Overview
The Hubtel Verification API allows you to verify your customer’s MSISDN name used in sim registration. Check the MSISDN Name Query for more info.

The Hubtel Verification API also allows you to check the Mobile Money wallet details of your customers. A merchant can verify details such as name and confirm if a customer is registered on mobile money. The following are the available channels through which a merchant can verify mobile money details.

Mobile Money Provider	Channel Name
MTN Ghana	mtn-gh
Telecel Ghana	vodafone-gh
AirtelTigo Ghana	tigo-gh

The Hubtel Verification API also allows you to check the correctness of a user's Ghana ID or Voter ID details and get a name match score to help decide whether a customer is eligible for a business partnership.


The Hubtel Verification API also allows you to confirm a customer's bank and bank account name before transferring money. Check Bank Account Name query for more info.


Getting Started

Business IP Whitelisting
You must share your public IP address with your Retail System Engineer for whitelisting.

bulb-icon
Note
All API Endpoints are live and only requests from whitelisted IP(s) can reach these endpoints shared in this reference.

API Reference
The Hubtel Verification API focuses on:

MSISDN Name Query.
Mobile Money Registration & Username Query.
Ghana ID Validation.
Voter ID Validation.
MTN Chenosis API.
Bank Account Name Query.

MSISDN Name Query
This endpoint can be used to query the MSISDN name used in sim registration.

To initiate a request, send an HTTP GET request to the below URL with the required parameters. Passing your Hubtel POS Sales ID in the endpoint is also mandatory. Find your POS Sales ID here.

API Endpoint	https://cs.hubtel.com/commissionservices/{Hubtel_POS_Sales_ID}/3e0841e70afc42fb97d13d19abd36384?destination={CustomerNumber}
Request Type	GET
Content Type	JSON

REQUEST PARAMETERS
Parameter	Type	Requirement	Description
Hubtel_POS_Sales_ID	Number	Mandatory	The merchant's Hubtel POS Sales ID. Find yours here.
destination	String	Mandatory	The customer's phone number.
Accepted formats: 0XXXXXXXXX / 233XXXXXXXXX E.g.: "0249111411" / "233249111411"

SAMPLE REQUEST
HTTP
cURL
PHP
Python
JS
HTTP

copy
Copy
GET commissionservices/11684/3e0841e70afc42fb97d13d19abd36384?destination=233501431586 HTTP/1.1
Host: cs.hubtel.com
Accept: application/json
Content-Type: application/json
Authorization: Basic endjeOBiZHhza250fT3==
Cache-Control: no-cache

RESPONSE PARAMETERS
Parameter	Type	Description
ResponseCode	String	The unique response code on the status of the request
Message	String	The status of the request
Label	String	The description of the response
Data	ArrayOfObject	An array of object containing the required data response from the Verification API.
Display	String	The detail of the response displayed E.g "name"
Value	String	The name resgistered on the SIM.
Amount	Float	A default decimal of 0.0 which is to be ignored.

SAMPLE RESPONSE
200 OK

copy
Copy
  {
    "ResponseCode": "0000",
    "Message": "Customer Details",
    "Label": "Customer Details",
    "Data": [
      {
        "Display": "name",
        "Value": "JOSEPH ANNOH",
        "Amount": 0.0
      }
    ]
  }

Mobile Money Registration & Username Query
This endpoint can be used to query whether a number is registered on Mobile Money and get the username on the Mobile Money account.

To initiate a request, send an HTTP GET request to the below URL with the required parameters. Passing your Hubtel POS Sales ID in the endpoint is also mandatory. Find your POS Sales ID here.

API Endpoint	https://rnv.hubtel.com/v2/merchantaccount/merchants/{Hubtel_POS_Sales_ID}/mobilemoney/verify?channel={channel}&customerMsisdn={CustomerNumber}
Request Type	GET
Content Type	JSON

REQUEST PARAMETERS
Parameter	Type	Requirement	Description
Hubtel_POS_Sales_ID	Number	Mandatory	The merchant's Hubtel POS Sales ID. Find yours here.
channel	String	Mandatory	The mobile money channel provider. Available channels are:
mtn-gh
vodafone-gh
tigo-gh
customerMsisdn	String	Mandatory	The customer’s mobile money number. Accepted formats: 0XXXXXXXXX / 233XXXXXXXXX E.g.: "0249111411" / "233249111411"

SAMPLE REQUEST
HTTP
cURL
PHP
Python
JS
HTTP

copy
Copy
GET v2/merchantaccount/merchants/11684/mobilemoney/verify?channel=vodafone-gh&customerMsisdn=0501431586 HTTP/1.1
Host: rnv.hubtel.com
Accept: application/json
Content-Type: application/json
Authorization: Basic endjeOBiZHhza250fT3==
Cache-Control: no-cache

RESPONSE PARAMETERS
Parameter	Type	Description
responseCode	String	The unique response code on the status of the request
message	String	The status of the request
data	Object	An object containing the required data response from the Verification API.
isRegistered	Boolean	States if a mobile wallet is registered.
name	String	Registered name on the mobile money account
status	String	The status of a mobile wallet
profile	String	This shows the profile of the number. E.g.
1. "Subscriber" means an individual
2. "Agent" means a mobile money vendor
3. "Merchant" means registered business.

SAMPLE RESPONSE
200 OK

copy
Copy
{
  "message": "Success",
  "responseCode": "0000",
  "data": {
    "isRegistered": true,
    "name": "JOSEPH ANNOH",
    "status": "active",
    "profile": "Subscriber"
  }
}
bulb-icon
Note
Kindly note that V1 doesn’t have a Profile parameter. It is only available for v2.


Ghana ID Validation
The Hubtel Verification API also allows you to check the correctness of a user's Ghana ID details and get a name match score to help decide whether a customer is eligible for a business partnership.

To initiate a request, send an HTTP POST request to the URL below with the required parameters. Passing your Hubtel POS Sales ID in the endpoint is also mandatory. Find your POS Sales ID here.

API Endpoint	https://rnv.hubtel.com/v2/merchantaccount/merchants/{Hubtel_POS_Sales_ID}/ghanacard/verify
Request Type	POST
Content Type	JSON

REQUEST PARAMETERS
Parameter	Type	Requirement	Description
Hubtel_POS_Sales_ID	Number	Mandatory	The merchant's Hubtel POS Sales ID. Find this here.
ghanaCardNumber	String	Mandatory	The customer's Ghana Card number.
The accepted format for the ghanacard same as printed on the card. E.g.: GHA-7XXXXXXXX-0
surname	String	Mandatory	The surname of the customer as printed on the card.
firstnames	String	Mandatory	The first name(s) of the customer as printed on the card.
gender	String	Mandatory	Gender of customer.
dateOfBirth	String	Mandatory	Date of birth of the customer. Accepted format: dd/mm/yyyy

SAMPLE REQUEST
HTTP
cURL
PHP
Python
JS
HTTP

copy
Copy
POST v2/merchantaccount/merchants/11684/ghanacard/verify HTTP/1.1
Host: rnv.hubtel.com
Accept: application/json
Content-Type: application/json
Authorization:Basic endjBiZHhza250fT==
Cache-Control: no-cache

{
  "ghanaCardNumber": "GHA-000000000-0",
  "surname": "Doe",
  "firstnames": "John",
  "gender": "male",
  "dateOfBirth": "dd/mm/yyyy"
}

RESPONSE PARAMETERS
Parameter	Type	Description
message	String	The status of the request.
responseCode	String	The unique response code on the status of the request.
data	Object	An object containing the required data response from the Verification API.
isValid	Boolean	true or false. Can be true when all provided details match and can be false when some details do not match.
score	String	The match percentage between the provided names and the names on the customer's Ghana ID.

SAMPLE QUERY RESPONSE
200 OK

copy
Copy
{
  "message": "Success",
  "responseCode": "0000",
  "data": {
      "isValid": true,
      "score": "100%"
  }
}

SAMPLE QUERY RESPONSE (NOT FOUND)
Not Found

copy
Copy
  {
    "message": "Not found",
    "responseCode": "3000",
    "data": null
  }

Voter ID Validation
The Hubtel Verification API also allows you to check the correctness of a user's Voter ID details and get a name match score to help decide whether a customer is eligible for a business partnership.

To initiate a request, send an HTTP POST request to the URL below with the required parameters. Passing your Hubtel POS Sales ID in the endpoint is also mandatory. Find your POS Sales ID here.

API Endpoint	https://rnv.hubtel.com/v2/merchantaccount/merchants/{Hubtel_POS_Sales_ID}/voteridcard/verify
Request Type	POST
Content Type	JSON

REQUEST PARAMETERS
Parameter	Type	Requirement	Description
Hubtel_POS_Sales_ID	Number	Mandatory	The merchant's Hubtel POS Sales ID. Find this here.
voterIdCardNumber	String	Mandatory	The customer's Voter ID number.
The accepted format for the Voter ID same as printed on the card. E.g.: 61610xxxx2
surname	String	Mandatory	The surname of the customer as printed on the card.
othernames	String	Mandatory	The other name(s) of the customer as printed on the card.
sex	String	Mandatory	Gender of customer.
dateOfBirth	String	Mandatory	Date of birth of the customer. Accepted format: yyyy/mm/dd

SAMPLE REQUEST
HTTP
cURL
PHP
Python
JS
HTTP

copy
Copy
POST v2/merchantaccount/merchants/11684/voteridcard/verify HTTP/1.1
Host: rnv.hubtel.com
Accept: application/json
Content-Type: application/json
Authorization:Basic endjBiZHhza250fT==
Cache-Control: no-cache

{
  "voterIdCardNumber": "0000000000",
  "surname": "Doe",
  "othernames": "John",
  "sex": "male",
  "dateOfBirth": "yyyy/mm/dd"
}

RESPONSE PARAMETERS
Parameter	Type	Description
message	String	The status of the request.
responseCode	String	The unique response code on the status of the request.
data	Object	An object containing the required data response from the Verification API.
isValid	Boolean	true or false. Can be true when all provided details match and can be false when some details do not match.
score	String	The match percentage between the provided names and the names on the customer's Voter ID.

SAMPLE QUERY RESPONSE
200 OK

copy
Copy
{
  "message": "Success",
  "responseCode": "0000",
  "data": {
      "isValid": true,
      "score": "100%"
  }
}

SAMPLE QUERY RESPONSE (NOT FOUND)
Not Found

copy
Copy
  {
    "message": "Not found",
    "responseCode": "3000",
    "data": null
  }

MTN Chenosis API
The Hubtel Verification API also allows you to check the validity of a customer’s basic details e.g.: date of birth, gender, etc., and help decide whether a customer is eligible for a business partnership, etc. by using the Customer's MTN MSISDN.

To initiate a request, send an HTTP GET request to the URL below with the required parameters. Passing your Hubtel POS Sales ID in the endpoint is also mandatory. Find your POS Sales ID here.

API Endpoint	https://rnv.hubtel.com/v2/merchantaccount/merchants/{Hubtel_POS_Sales_ID}/idcard/verify?idtype=ghanacard&idnumber={CustomerMsisdn}&network=MTN&consentType={consentType}
Request Type	GET
Content Type	JSON

REQUEST PARAMETERS
Parameter	Type	Requirement	Description
Hubtel_POS_Sales_ID	Number	Mandatory	The merchant's Hubtel POS Sales ID. Find this here.
idnumber	String	Mandatory	The customer's MTN number. Accepted formats: 233XXXXXXXXX and 0XXXXXXXXX
consentType	String	Optional	The preferred consent type. Options include:
1. sms
2. ussd
SAMPLE REQUEST
HTTP
cURL
PHP
Python
JS
HTTP

copy
Copy
GET v2/merchantaccount/merchants/11684/idcard/verify?idtype=ghanacard&idnumber=233XXXXXXXXX&network=MTN&consentType=ussd HTTP/1.1
Host: rnv.hubtel.com
Accept: application/json
Content-Type: application/json
Authorization:Basic endjBiZHhza250fT==
Cache-Control: no-cache

RESPONSE PARAMETERS
Parameter	Type	Description
message	String	The status of the request.
responseCode	String	The unique response code on the status of the request.
data	Object	An object containing the required data response from the Verification API.
name	String	Registered name on the Ghana Card.
dateOfBirth	String	Date of birth of the Cardholder.
gender	String	Gender of Cardholder.
nationalId	String	Ghana Card Identification number.

SAMPLE QUERY RESPONSE
200 OK

copy
Copy
  {
    "message": "Success",
    "responseCode": "0000",
    "data": {
      "name": "JOHN DONATUS MILLS",
      "dateOfBirth": "1984 June 23",
      "gender": "MALE",
      "nationalId": "GHA-000000000-0"
    }
  }

SAMPLE QUERY RESPONSE (NOT FOUND)
Not Found

copy
Copy
  {
    "message": "Not found",
    "responseCode": "3000",
    "data": null
  }

Bank Account Name Query
This endpoint can be used to confirm a customer's bank and bank account name before transferring money.

The following are available Bank channels through which a merchant can query a bank account name associated with a bank account number on Hubtel.

Bank Channel	BankCode
STANDARD CHARTERED BANK	300302
ABSA BANK GHANA LIMITED	300303
GCB BANK LIMITED	300304
NATIONAL INVESTMENT BANK	300305
ARB APEX BANK LIMITED	300306
AGRICULTURAL DEVELOPMENT BANK	300307
UNIVERSAL MERCHANT BANK	300309
REPUBLIC BANK LIMITED	300310
ZENITH BANK GHANA LTD	300311
ECOBANK GHANA LTD	300312
CAL BANK LIMITED	300313
FIRST ATLANTIC BANK	300316
PRUDENTIAL BANK LTD	300317
STANBIC BANK	300318
FIRST BANK OF NIGERIA	300319
BANK OF AFRICA	300320
GUARANTY TRUST BANK	300322
FIDELITY BANK LIMITED	300323
SAHEL - SAHARA BANK (BSIC)	300324
UNITED BANK OF AFRICA	300325
ACCESS BANK LTD	300329
CONSOLIDATED BANK GHANA	300331
FIRST NATIONAL BANK	300334
GHL BANK	300362

To initiate a request, send an HTTP GET request to the below URL with the required parameters. Passing your Hubtel POS Sales ID in the endpoint is also mandatory. Find your POS Sales ID here.


API Endpoint	https://rnv.hubtel.com/v2/merchantaccount/merchants/{Hubtel_POS_Sales_ID}/bank/verify/{bankcode}/{bankAccountNumber}
Request Type	GET
Content Type	JSON

SAMPLE REQUEST(BANK ACCOUNT QUERY)
HTTP
cURL
PHP
Python
JS
HTTP

copy
Copy
GET v2/merchantaccount/merchants/11684/bank/verify/300312/144100225608 HTTP/1.1
Host: rnv.hubtel.com
Accept: application/json
Content-Type: application/json
Authorization:Basic endjBiZHhza250fT==
Cache-Control: no-cache

RESPONSE PARAMETERS
Parameter	Type	Description
responseCode	String	The unique response code on the status of the request
message	String	The status of the request
data	Object	An object containing the required data response from the Verification API.
name	String	Registered name of the Bank Account.
SAMPLE SUCCESSFUL QUERY RESPONSE
HTTP

copy
Copy
  {
    "message": "Success",
    "responseCode": "0000",
    "data": {
      "name": "JOHN DOE"
    }
  }

SAMPLE FAILED QUERY RESPONSE
HTTP

copy
Copy
  {
    "message": "We're sorry, we could not verify this account. Do you want to save anyway?",
    "responseCode": "2001",
    "data": null
  }

Response Codes
The Hubtel Recurring Payments API uses standard HTTP error reporting. Successful requests return HTTP status codes in the 2xx. Failed requests return status codes in 4xx and 5xx.

Response Codes are included in the JSON response body, which contains information about the error or status

HTTP Status Code	ResponseCode	Description	Required Action
200	0000	The request has been processed successfully	None
424	2001	Failed dependency	Data currently not available and might take a while to sync with external source
400	2001	We're sorry, we could not verify this account. Do you want to save anyway?	Kindly pass a valid account number
404	3000 / 2001	- AirtelTigo Exception. Invalid Account
- Vodafone Exception. Invalid Account
- MTN Exception. Account holder with FRI Not Found
- Not found	- Number not registered with Telco
- Card might be newly issued or invalid. The cardholder would have to reach out to the card issuer for further assistance
400	4000	Missing required parameter CustomerMsisdn	Try again with a well-formed valid request
Next

Refund API