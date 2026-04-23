{{/*
Chart name, truncated to 63 chars.
*/}}
{{- define "hightower.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Fully qualified app name, truncated to 63 chars.
*/}}
{{- define "hightower.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Chart label value.
*/}}
{{- define "hightower.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels.
*/}}
{{- define "hightower.labels" -}}
helm.sh/chart: {{ include "hightower.chart" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
API component name.
*/}}
{{- define "hightower.api.fullname" -}}
{{- printf "%s-api" (include "hightower.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
API selector labels.
*/}}
{{- define "hightower.api.selectorLabels" -}}
app: {{ include "hightower.api.fullname" . }}
{{- end }}

{{/*
Temporal component name.
*/}}
{{- define "hightower.temporal.fullname" -}}
{{- printf "%s-temporal" (include "hightower.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Temporal service name (same as fullname).
*/}}
{{- define "hightower.temporal.serviceName" -}}
{{- include "hightower.temporal.fullname" . }}
{{- end }}

{{/*
Temporal selector labels.
*/}}
{{- define "hightower.temporal.selectorLabels" -}}
app: {{ include "hightower.temporal.fullname" . }}
{{- end }}

{{/*
Router component name.
*/}}
{{- define "hightower.router.fullname" -}}
{{- printf "%s-router" (include "hightower.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Router selector labels.
*/}}
{{- define "hightower.router.selectorLabels" -}}
app: {{ include "hightower.router.fullname" . }}
{{- end }}

{{/*
CNPG cluster name.
*/}}
{{- define "hightower.cnpg.fullname" -}}
{{- printf "%s-temporal-db" (include "hightower.fullname" .) | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
CNPG read-write service name (CNPG auto-creates <cluster>-rw).
*/}}
{{- define "hightower.cnpg.serviceName" -}}
{{- printf "%s-rw" (include "hightower.cnpg.fullname" .) }}
{{- end }}

{{/*
Service account name for the API.
*/}}
{{- define "hightower.serviceAccountName" -}}
{{- if .Values.api.serviceAccount.name }}
{{- .Values.api.serviceAccount.name }}
{{- else }}
{{- include "hightower.api.fullname" . }}
{{- end }}
{{- end }}

{{/*
Postgres seeds host — use override or default to CNPG service.
*/}}
{{- define "hightower.temporal.postgresSeeds" -}}
{{- if .Values.temporal.db.host }}
{{- .Values.temporal.db.host }}
{{- else }}
{{- include "hightower.cnpg.serviceName" . }}
{{- end }}
{{- end }}
