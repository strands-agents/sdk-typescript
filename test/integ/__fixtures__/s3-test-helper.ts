/**
 * S3 test helper utilities for integration tests.
 *
 * Provides functions to upload test resources to S3 and return their URIs
 * for use in media block integration tests.
 */

import { S3Client, CreateBucketCommand, HeadBucketCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts'
import { fromNodeProviderChain } from '@aws-sdk/credential-providers'
import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'

const S3_REGION = 'us-west-2'

/**
 * S3 test resources containing URIs for uploaded test files.
 */
export interface S3TestResources {
  imageUri: string
  documentUri: string
  videoUri: string
}

/**
 * Gets the current AWS account ID using STS.
 *
 * @returns AWS account ID
 */
async function getAccountId(): Promise<string> {
  const stsClient = new STSClient({
    region: S3_REGION,
    credentials: fromNodeProviderChain(),
  })

  const response = await stsClient.send(new GetCallerIdentityCommand({}))
  return response.Account!
}

/**
 * Ensures the test bucket exists, creating it if necessary.
 *
 * @param s3Client - S3 client
 * @param bucketName - Bucket name to create/verify
 */
async function ensureBucket(s3Client: S3Client, bucketName: string): Promise<void> {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }))
    console.log(`Bucket ${bucketName} already exists`)
  } catch {
    try {
      await s3Client.send(
        new CreateBucketCommand({
          Bucket: bucketName,
          CreateBucketConfiguration: {
            LocationConstraint: S3_REGION,
          },
        })
      )
      console.log(`Created test bucket: ${bucketName}`)
      // Wait for bucket to be available
      await new Promise((resolve) => globalThis.setTimeout(resolve, 2000))
    } catch (createError) {
      // Bucket may already exist if created by another run
      const errorMessage = createError instanceof Error ? createError.message : String(createError)
      if (!errorMessage.includes('BucketAlreadyOwnedByYou')) {
        throw createError
      }
      console.log(`Bucket ${bucketName} already exists (owned by you)`)
    }
  }
}

/**
 * Uploads test resources to S3.
 *
 * @param s3Client - S3 client
 * @param bucketName - Target bucket name
 * @returns S3 URIs for uploaded resources
 */
async function uploadTestResources(s3Client: S3Client, bucketName: string): Promise<S3TestResources> {
  // Get the directory of this module
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const resourcesDir = path.join(__dirname, '..', '__resources__')

  // Define test files to upload
  const files = [
    { localPath: path.join(resourcesDir, 'yellow.png'), key: 'test-images/yellow.png', contentType: 'image/png' },
    {
      localPath: path.join(resourcesDir, 'letter.pdf'),
      key: 'test-documents/letter.pdf',
      contentType: 'application/pdf',
    },
    { localPath: path.join(resourcesDir, 'blue.mp4'), key: 'test-videos/blue.mp4', contentType: 'video/mp4' },
  ]

  // Upload each file
  for (const file of files) {
    const fileContent = fs.readFileSync(file.localPath)
    await s3Client.send(
      new PutObjectCommand({
        Bucket: bucketName,
        Key: file.key,
        Body: fileContent,
        ContentType: file.contentType,
      })
    )
    console.log(`Uploaded test file to s3://${bucketName}/${file.key}`)
  }

  return {
    imageUri: `s3://${bucketName}/test-images/yellow.png`,
    documentUri: `s3://${bucketName}/test-documents/letter.pdf`,
    videoUri: `s3://${bucketName}/test-videos/blue.mp4`,
  }
}

/**
 * Gets S3 test resources by uploading test files to S3.
 * This is the main entry point for S3 test setup.
 *
 * @returns S3 test resources with URIs
 * @throws Error if AWS credentials are unavailable
 */
export async function getS3TestResources(): Promise<S3TestResources> {
  const accountId = await getAccountId()
  const bucketName = `strands-integ-tests-resources-${accountId}`

  const s3Client = new S3Client({
    region: S3_REGION,
    credentials: fromNodeProviderChain(),
  })

  await ensureBucket(s3Client, bucketName)
  return await uploadTestResources(s3Client, bucketName)
}
