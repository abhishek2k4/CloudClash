// Demo questions so the engine can be tested immediately.
// Replace these with the approved event questions before CLOUD CLASH.
// correctOption is zero-based: 0 = first option, 1 = second option, etc.
export const QUESTIONS = {
  1: [
    { text: "Which AWS service provides virtual servers in the cloud?", options: ["Amazon EC2", "Amazon S3", "Amazon RDS", "AWS Lambda"], correctOption: 0, explanation: "Amazon EC2 provides resizable compute capacity." },
    { text: "Which service is primarily used for object storage?", options: ["Amazon VPC", "Amazon S3", "Amazon Route 53", "Amazon EBS"], correctOption: 1, explanation: "Amazon S3 is AWS object storage." }
  ],
  2: [
    { text: "Which AWS service is designed for serverless functions?", options: ["Amazon EC2", "Amazon EKS", "AWS Lambda", "Amazon Lightsail"], correctOption: 2, explanation: "AWS Lambda runs code without managing servers." },
    { text: "Which AWS service provides a managed relational database?", options: ["Amazon RDS", "Amazon CloudFront", "Amazon SQS", "AWS IAM"], correctOption: 0, explanation: "Amazon RDS manages relational database engines." }
  ]
};
