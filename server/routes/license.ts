import { RequestHandler } from "express";
import { ValidateLicenseRequest, ValidateLicenseResponse } from "@shared/api";
import { validateLicense } from "../services/license-service";
import { getLicenseHost } from "../utils/license-host";

export const validateLicenseHandler: RequestHandler = async (req, res) => {
  try {
    const { licenseKey } = req.body as ValidateLicenseRequest;

    const host = getLicenseHost(req);
    if (!host) {
      return res.status(503).json({
        valid: false,
        message: "The licensed server hostname is not configured.",
        errorCode: "LICENSE_HOST_CONFIG_MISSING",
      });
    }

    if (!licenseKey || typeof licenseKey !== "string") {
      return res.status(400).json({
        valid: false,
        message: "Enter your license key to activate the application.",
        errorCode: "LICENSE_NOT_PROVIDED",
      });
    }

    const result = await validateLicense(host, licenseKey);
    const response: ValidateLicenseResponse = {
      valid: result.valid,
      message: result.message,
      errorCode: result.errorCode,
      licensee: result.valid ? result.licensee : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error("[License] Validation error:", error);
    res.status(500).json({
      valid: false,
      message: "License validation failed",
    });
  }
};

export const checkLicenseStatusHandler: RequestHandler = async (req, res) => {
  try {
    const host = getLicenseHost(req);
    if (!host) {
      return res.status(503).json({
        valid: false,
        message: "The licensed server hostname is not configured.",
        errorCode: "LICENSE_HOST_CONFIG_MISSING",
      });
    }

    const result = await validateLicense(host);
    const response: ValidateLicenseResponse = {
      valid: result.valid,
      message: result.message,
      errorCode: result.errorCode,
      licensee: result.valid ? result.licensee : undefined,
    };

    res.json(response);
  } catch (error) {
    console.error("[License] Status check error:", error);
    res.status(500).json({
      valid: false,
      message: "License status check failed",
    });
  }
};
