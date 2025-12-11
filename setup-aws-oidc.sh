#!/bin/bash

# Setup AWS OIDC for GitHub Actions
# This script creates the OIDC identity provider and IAM role for GitHub Actions
#
# Usage:
#   ./setup-aws-oidc.sh [OPTIONS]
#
# Options:
#   --repository REPO    GitHub repository in format 'owner/repo' (REQUIRED)
#   --role-name NAME     IAM role name to create (default: StrandsActionRole)
#   --region REGION      AWS region to use (default: us-west-2)
#   --policy-name NAME   IAM policy name to create (default: StrandsActionPolicy)
#   --help               Show this help message
#
# Examples:
#   ./setup-aws-oidc.sh --repository myorg/myrepo                    # Minimal setup
#   ./setup-aws-oidc.sh --repository myorg/myrepo --role-name MyRole # Custom repo and role
#   ./setup-aws-oidc.sh --repository myorg/myrepo --region us-east-1 # Custom repo and region
#   ./setup-aws-oidc.sh --repository myorg/myrepo --role-name MyRole --region us-east-1 --policy-name MyPolicy
#
# Prerequisites:
#   - AWS CLI installed and configured with appropriate permissions
#   - IAM permissions to create roles, policies, and OIDC providers
#
# What this script does:
#   1. Creates GitHub OIDC Identity Provider (if not exists)
#   2. Creates IAM role with repository-specific trust policy
#   3. Creates IAM policy with Bedrock and S3 permissions
#   4. Attaches policy to role
#   5. Outputs role ARN for GitHub repository configuration

set -e

# Default values
GITHUB_REPO="JackYPCOnline/sdk-typescript"  # Required - no default
ROLE_NAME="StrandsActionRole"
AWS_REGION="${AWS_REGION:-us-west-2}"
POLICY_NAME="StrandsActionPolicy"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --repository)
            GITHUB_REPO="$2"
            shift 2
            ;;
        --role-name)
            ROLE_NAME="$2"
            shift 2
            ;;
        --region)
            AWS_REGION="$2"
            shift 2
            ;;
        --policy-name)
            POLICY_NAME="$2"
            shift 2
            ;;
        --help)
            echo "Setup AWS OIDC for GitHub Actions"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --repository REPO    GitHub repository in format 'owner/repo' (REQUIRED)"
            echo "  --role-name NAME     IAM role name to create (default: $ROLE_NAME)"
            echo "  --region REGION      AWS region to use (default: $AWS_REGION)"
            echo "  --policy-name NAME   IAM policy name to create (default: $POLICY_NAME)"
            echo "  --help               Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0 --repository myorg/myrepo                    # Minimal setup"
            echo "  $0 --repository myorg/myrepo --role-name MyRole # Custom repo and role"
            echo "  $0 --repository myorg/myrepo --region us-east-1 # Custom repo and region"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Validate required parameters
if [[ -z "$GITHUB_REPO" ]]; then
    echo "❌ Error: --repository is required"
    echo "Usage: $0 --repository owner/repo [OPTIONS]"
    echo "Use --help for more information"
    exit 1
fi

echo "🚀 Setting up AWS OIDC for GitHub Actions..."
echo "Repository: $GITHUB_REPO"
echo "Region: $AWS_REGION"

# Step 1: Create OIDC Identity Provider
echo "📝 Step 1: Creating OIDC Identity Provider..."

# Check if OIDC provider already exists
if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com" &>/dev/null; then
    echo "✅ OIDC Identity Provider already exists"
else
    echo "Creating OIDC Identity Provider..."
    aws iam create-open-id-connect-provider \
        --url https://token.actions.githubusercontent.com \
        --client-id-list sts.amazonaws.com \
        --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1 \
        --thumbprint-list 1c58a3a8518e8759bf075b76b750d4f2df264fcd

    echo "✅ OIDC Identity Provider created successfully"
fi

# Step 2: Create Trust Policy for the Role
echo "📝 Step 2: Creating trust policy..."

cat > trust-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Principal": {
                "Federated": "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):oidc-provider/token.actions.githubusercontent.com"
            },
            "Action": "sts:AssumeRoleWithWebIdentity",
            "Condition": {
                "StringLike": {
                    "token.actions.githubusercontent.com:sub": "repo:${GITHUB_REPO}:*"
                },
                "StringEquals": {
                    "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
                }
            }
        }
    ]
}
EOF

# Step 3: Create IAM Role
echo "📝 Step 3: Creating IAM Role..."

if aws iam get-role --role-name "$ROLE_NAME" &>/dev/null; then
    echo "⚠️  Role $ROLE_NAME already exists, updating trust policy..."
    aws iam update-assume-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-document file://trust-policy.json
else
    echo "Creating IAM Role..."
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file://trust-policy.json \
        --description "Role for GitHub Actions OIDC authentication"
fi

# Step 4: Create and attach permissions policy
echo "📝 Step 4: Creating permissions policy..."

cat > permissions-policy.json << EOF
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "bedrock:*",
                "bedrock-runtime:*",
                "bedrock-agent:*",
                "bedrock-agent-runtime:*",
                "s3:GetObject",
                "s3:PutObject",
                "s3:ListBucket",
                "sts:GetCallerIdentity"
            ],
            "Resource": "*"
        }
    ]
}
EOF

# Create or update the policy
if aws iam get-policy --policy-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/$POLICY_NAME" &>/dev/null; then
    echo "⚠️  Policy $POLICY_NAME already exists, updating..."
    aws iam create-policy-version \
        --policy-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/$POLICY_NAME" \
        --policy-document file://permissions-policy.json \
        --set-as-default
else
    echo "Creating permissions policy..."
    aws iam create-policy \
        --policy-name "$POLICY_NAME" \
        --policy-document file://permissions-policy.json \
        --description "Permissions for GitHub Actions to access AWS services"
fi

# Attach policy to role
echo "📝 Step 5: Attaching policy to role..."
aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::$(aws sts get-caller-identity --query Account --output text):policy/$POLICY_NAME"

# Cleanup temporary files
rm -f trust-policy.json permissions-policy.json

# Get the role ARN
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

echo ""
echo "🎉 Setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Add this role ARN to your GitHub repository secrets:"
echo "   Secret name: AWS_ROLE_ARN"
echo "   Secret value: $ROLE_ARN"
echo ""
echo "2. Remove the following secrets from your GitHub repository:"
echo "   - AWS_ACCESS_KEY_ID"
echo "   - AWS_SECRET_ACCESS_KEY"
echo "   - AWS_SESSION_TOKEN"
echo ""
echo "3. The GitHub Actions workflow will be updated automatically."
echo ""
echo "Role ARN: $ROLE_ARN"