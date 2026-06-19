import { seedAiControlPlane } from "@/lib/ai/bootstrap";
import { repository } from "@/lib/db/repository";

repository.reset();
seedAiControlPlane(repository);
console.log(JSON.stringify({
  providers: repository.providers.size,
  models: repository.models.size,
  promptTemplates: repository.promptTemplates.size,
  promptVersions: repository.promptVersions.size,
  deployments: repository.deployments.size
}, null, 2));
