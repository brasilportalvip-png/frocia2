import { createHash, randomUUID } from "node:crypto";
import { getApp } from "firebase-admin/app";
import { GoogleGenAI } from "@google/genai";
import {
  adminDb,
  getMediaStorageBucket,
  getServiceAccountCredentials,
} from "../lib/firebaseAdmin.js";
import { CreditWalletService } from "../services/creditWalletService.js";
import type { ProfessionalBuild } from "./professionalBuildService.js";
import { FactoryError } from "./professionalContract.js";
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function asset(b: ProfessionalBuild, index: number, video: boolean) {
  const id = b.id + "-" + (video ? "video" : index);
  const ref = adminDb.collection("site_factory_media").doc(id);
  let state = (await ref.get()).data();
  const amount = video ? 120 : 18;
  let attempt = Number(state?.attempt || 0);
  let billingKey = state?.billingKey || "factory-media:" + id;
  if (state?.status === "starting" || state?.status === "failed") {
    if (state.reservationId)
      await CreditWalletService.releaseReservation({
        userId: b.userId,
        reservationId: state.reservationId,
        idempotencyKey: billingKey + ":release",
        operation: "Mídia sem entrega confirmada",
      });
    if (attempt >= 2)
      throw new FactoryError(
        "media_retry_exhausted",
        "A mídia não foi entregue após três tentativas; os créditos sem entrega foram liberados.",
      );
    attempt++;
    billingKey = "factory-media:" + id + ":attempt:" + attempt;
    state = undefined;
  }
  const settle = async (s: any) => {
    await CreditWalletService.confirmConsumption({
      userId: b.userId,
      reservationId: s.reservationId,
      amountConsumed: amount,
      idempotencyKey: billingKey + ":confirm",
      operation: video ? "Vídeo Veo da fábrica" : "Imagem da fábrica",
    });
    return {
      creditsSpent: amount,
      type: video ? "video" : "image",
      url: s.url,
      sha256: s.sha256,
      model: s.model,
      operationName: s.operationName || null,
    };
  };
  if (state?.status === "ready") return settle(state);
  const bucket = await getMediaStorageBucket();
  const prompt = (
    "Crie mídia cinematográfica profissional e realista para o projeto a seguir. Não inclua logotipos ou pessoas reais sem autorização. " +
    b.brief.prompt
  ).slice(0, 5000);
  const reservation = state?.reservationId
    ? { reservationId: state.reservationId }
    : await CreditWalletService.reserveCredits({
        userId: b.userId,
        amount,
        operation: video ? "Vídeo Veo da fábrica" : "Imagem da fábrica",
        idempotencyKey: billingKey,
      });
  try {
    let bytes: Buffer | undefined;
    let mime = "image/jpeg";
    let model = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
    if (video) {
      model = process.env.VEO_VERTEX_MODEL || "veo-3.1-generate-001";
      const project =
        process.env.VEO_VERTEX_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        getServiceAccountCredentials()?.projectId;
      if (
        !project ||
        !/^[a-z][a-z0-9-]{4,60}$/.test(project) ||
        !/^veo-3(?:\.1)?-[a-z0-9-]+$/.test(model)
      )
        throw new FactoryError(
          "veo_unconfigured",
          "Configure VEO_VERTEX_PROJECT_ID e acesso ao Veo no executor.",
        );
      const credential = getApp().options.credential;
      if (!credential)
        throw new FactoryError(
          "veo_credential_missing",
          "Credencial Google Cloud indisponível.",
        );
      const token = (await credential.getAccessToken()).access_token;
      const endpoint =
        "https://us-central1-aiplatform.googleapis.com/v1/projects/" +
        project +
        "/locations/us-central1/publishers/google/models/" +
        model;
      if (!state?.operationName) {
        await ref.set({
          status: "starting",
          attempt,
          billingKey,
          reservationId: reservation.reservationId,
          model,
        });
        const response = await fetch(endpoint + ":predictLongRunning", {
          method: "POST",
          headers: {
            Authorization: "Bearer " + token,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: {
              storageUri:
                "gs://" + bucket.name + "/factory-video/" + b.id + "/",
              sampleCount: 1,
              durationSeconds: 8,
              aspectRatio: "16:9",
              resolution: "1080p",
              generateAudio: true,
            },
          }),
          signal: AbortSignal.timeout(30000),
        });
        if (!response.ok)
          throw new FactoryError(
            "veo_provider_error",
            "O Veo recusou a geração (HTTP " + response.status + ").",
          );
        const operation = await response.json();
        if (
          typeof operation.name !== "string" ||
          !operation.name.startsWith(
            "projects/" + project + "/locations/us-central1/",
          )
        )
          throw new FactoryError(
            "veo_operation_invalid",
            "O Veo não retornou uma operação válida.",
          );
        await ref.set({
          status: "running",
          attempt,
          billingKey,
          operationName: operation.name,
          reservationId: reservation.reservationId,
          model,
        });
        return null;
      }
      const response = await fetch(endpoint + ":fetchPredictOperation", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ operationName: state.operationName }),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok)
        throw new FactoryError(
          "veo_poll_error",
          "Não foi possível consultar o Veo.",
        );
      const operation = await response.json();
      if (!operation.done) return null;
      if (operation.error)
        throw new FactoryError(
          "veo_generation_failed",
          "O Veo não concluiu o vídeo.",
        );
      const uri = operation.response?.videos?.[0]?.gcsUri;
      const prefix = "gs://" + bucket.name + "/factory-video/" + b.id + "/";
      if (typeof uri !== "string" || !uri.startsWith(prefix))
        throw new FactoryError(
          "veo_output_invalid",
          "O Veo não retornou o arquivo esperado.",
        );
      [bytes] = await bucket
        .file(uri.slice(("gs://" + bucket.name + "/").length))
        .download();
      mime = "video/mp4";
    } else {
      const apiKey =
        process.env.GEMINI_MEDIA_API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey)
        throw new FactoryError(
          "image_unconfigured",
          "Credencial de geração de imagens não configurada.",
        );
      await ref.set({
        status: "starting",
        attempt,
        billingKey,
        reservationId: reservation.reservationId,
        model,
      });
      const interaction = await new GoogleGenAI({
        apiKey,
        httpOptions: { timeout: 90000, retryOptions: { attempts: 1 } },
      }).interactions.create({
        model,
        input: prompt + " Composição " + (index + 1) + ", horizontal.",
        response_format: {
          type: "image",
          mime_type: "image/jpeg",
          aspect_ratio: "16:9",
          image_size: "2K",
        },
      });
      const image = interaction.output_image;
      if (!image?.data)
        throw new FactoryError(
          "image_output_missing",
          "O provedor não entregou uma imagem.",
        );
      bytes = Buffer.from(image.data, "base64");
      mime = image.mime_type || "image/jpeg";
    }
    if (!bytes?.length || bytes.length > 80000000)
      throw new FactoryError(
        "media_size_invalid",
        "Arquivo de mídia vazio ou maior que o limite.",
      );
    const objectPath =
      "factory-public/" +
      b.id +
      "/" +
      (video ? "video.mp4" : "image-" + index + ".jpg");
    const downloadToken = randomUUID();
    await bucket.file(objectPath).save(bytes, {
      resumable: false,
      contentType: mime,
      metadata: {
        cacheControl: "public,max-age=31536000,immutable",
        metadata: { firebaseStorageDownloadTokens: downloadToken },
      },
    });
    const record = {
      status: "ready",
      attempt,
      billingKey,
      reservationId: reservation.reservationId,
      url:
        "https://firebasestorage.googleapis.com/v0/b/" +
        bucket.name +
        "/o/" +
        encodeURIComponent(objectPath) +
        "?alt=media&token=" +
        downloadToken,
      sha256: sha(bytes),
      model,
      operationName: state?.operationName || null,
    };
    await ref.set(record);
    return settle(record);
  } catch (e) {
    if (
      state?.operationName &&
      (e instanceof TypeError ||
        (e instanceof FactoryError && e.code === "veo_poll_error"))
    )
      return null;
    if ((await ref.get()).data()?.status !== "ready") {
      await ref.set({
        status: "failed",
        attempt,
        billingKey,
        reservationId: reservation.reservationId,
        model: state?.model || null,
      });
      await CreditWalletService.releaseReservation({
        userId: b.userId,
        reservationId: reservation.reservationId,
        idempotencyKey: billingKey + ":release",
        operation: "Mídia sem entrega final",
      }).catch(() => {});
    }
    throw e;
  }
}
export async function generateFactoryMedia(b: ProfessionalBuild) {
  const assets = [];
  for (let index = 0; index < b.brief.media.images; index++) {
    const prior = (
      await adminDb
        .collection("site_factory_media")
        .doc(b.id + "-" + index)
        .get()
    ).data();
    const image = await asset(b, index, false);
    if (image) assets.push(image);
    if (prior?.status !== "ready")
      return { complete: false, assets, message: "Imagens em geração." };
  }
  if (b.brief.media.video) {
    const video = await asset(b, 0, true);
    if (!video)
      return { complete: false, assets, message: "Vídeo em geração no Veo." };
    assets.push(video);
  }
  return { complete: true, assets };
}
