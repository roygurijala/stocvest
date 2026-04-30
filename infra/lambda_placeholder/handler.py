"""Phase 6e Terraform placeholder — replace zip via CI with real `stocvest` package."""

import json


def lambda_handler(event, context):
    return {
        "statusCode": 501,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"message": "Phase 6e placeholder — deploy application bundle in CI/CD."}),
    }
