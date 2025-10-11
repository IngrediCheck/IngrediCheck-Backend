# CI/CD GitHub Actions for Supabase Edge Functions

This directory contains GitHub Actions workflows for automatically deploying Supabase Edge Functions to your Supabase project.

## Workflows

### `deploy-edge-functions-prod.yml`

Deploys the `ingredicheck` and `background` edge functions to the production Supabase project whenever changes are pushed to the `main` branch.

**Triggers:**
- Push to `main` branch (when files in `supabase/functions/` or this workflow change)
- Manual workflow dispatch

**Functions Deployed:**
- `ingredicheck` - Main API function with ingredient analysis, extraction, and user management
- `background` - Background logging and data processing function

## Required GitHub Environment Variables

Configure these on the repository’s **PROD** environment (Settings → Environments → PROD → Configure):

### Secrets
- `SUPABASE_ACCESS_TOKEN`
  - Personal access token for Supabase CLI authentication.

### Variables
- `SUPABASE_PROJECT_REF`
  - Supabase project reference ID (Settings → General in the Supabase dashboard).

## Workflow Features

- **Path-based triggers**: Only runs when function files change
- **Manual triggering**: Can be triggered manually from GitHub Actions tab
- **Deployment verification**: Lists deployed functions after deployment
- **Error handling**: Fails fast if any step encounters an error
- **Detailed logging**: Provides clear output for debugging

## Monitoring Deployments

1. Go to your GitHub repository
2. Click on **Actions** tab
3. Look for "Deploy Supabase Edge Functions" workflow runs
4. Click on any run to see detailed logs

## Troubleshooting

### Common Issues

**Authentication Failed**
- Verify `SUPABASE_ACCESS_TOKEN` is correct and not expired
- Ensure the token has sufficient permissions

**Project Link Failed**
- Verify `SUPABASE_PROJECT_REF` is correct
- Ensure you have access to the project

**Function Deployment Failed**
- Check function code for syntax errors
- Verify all imports and dependencies are correct
- Check Supabase project limits and quotas

### Manual Deployment

If you need to deploy manually:

```bash
# Install Supabase CLI
npm install -g supabase@latest

# Login
supabase login

# Link to project
supabase link --project-ref YOUR_PROJECT_REF

# Deploy functions
supabase functions deploy ingredicheck
supabase functions deploy background
```

## Security Notes

- Never commit access tokens or project references to the repository
- Use GitHub Secrets for all sensitive information
- Regularly rotate your Supabase access tokens
- Monitor deployment logs for any suspicious activity

## Support

For issues with this workflow:
1. Check the GitHub Actions logs for detailed error messages
2. Verify all secrets are correctly configured
3. Test manual deployment using Supabase CLI
4. Check Supabase documentation for function deployment requirements
