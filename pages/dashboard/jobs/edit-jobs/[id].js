import { Row, Col, Container, Card } from 'react-bootstrap';
import { GeeksSEO } from 'widgets'
import toast from 'react-hot-toast';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
import { useEffect } from 'react';
import { useJobDetailQuery } from '../../../../hooks/queries/useJobDetailQuery';
import { mapJobDetailToEditForm } from '../../../../lib/jobs/mapJobDetailToEditForm';
import Link from 'next/link';
import EditJobFormSkeleton from '../../../../sub-components/dashboard/jobs/_components/EditJobFormSkeleton';

const pageHeaderStyle = {
  background: "linear-gradient(90deg, #4171F5 0%, #3DAAF5 100%)",
  padding: "1.5rem 2rem",
  borderRadius: "0 0 24px 24px",
  marginTop: "-39px",
  marginLeft: "10px",
  marginRight: "10px",
  marginBottom: "20px",
};

function EditJobPageLoading({ jobNo = null, message, subMessage }) {
  return (
    <Container>
      <GeeksSEO title="Edit Job | SAS&ME - SAP B1 | Portal" />
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div style={pageHeaderStyle}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1
                    className="mb-2"
                    style={{
                      fontSize: "28px",
                      fontWeight: "600",
                      color: "#FFFFFF",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {jobNo ? `Edit Job #${jobNo}` : "Edit Job"}
                  </h1>
                  <p
                    className="mb-2"
                    style={{
                      fontSize: "16px",
                      color: "rgba(255, 255, 255, 0.7)",
                      fontWeight: "400",
                      lineHeight: "1.5",
                    }}
                  >
                    Update job details, assignments, and schedules
                  </p>
                </div>

                <nav style={{ fontSize: "14px", fontWeight: "500" }}>
                  <div className="d-flex align-items-center">
                    <i
                      className="fe fe-home"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    ></i>
                    <Link
                      href="/dashboard"
                      className="text-decoration-none ms-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Dashboard
                    </Link>
                    <span className="mx-2" style={{ color: "rgba(255, 255, 255, 0.7)" }}>
                      /
                    </span>
                    <Link
                      href="/dashboard/jobs/list-jobs"
                      className="text-decoration-none"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Jobs
                    </Link>
                    <span className="mx-2" style={{ color: "rgba(255, 255, 255, 0.7)" }}>
                      /
                    </span>
                    <span style={{ color: "#FFFFFF" }}>Edit Job</span>
                  </div>
                </nav>
              </div>
            </div>
          </div>
        </Col>
        <Col xl={12} lg={12} md={12} sm={12}>
          <Card className="shadow-sm">
            <Card.Body>
              <EditJobFormSkeleton message={message} subMessage={subMessage} />
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
}

const EditJobs = dynamic(
  () => import('sub-components/dashboard/jobs/EditJobs'),
  {
    ssr: false,
    loading: () => (
      <EditJobPageLoading
        message="Please wait while we load the form"
        subMessage="Preparing the job editor..."
      />
    ),
  }
);

const EditJobPage = () => {
  const router = useRouter();
  const rawId = router.query?.id;
  const id = Array.isArray(rawId) ? rawId[0] : rawId;
  const {
    data: jobData,
    isLoading,
    isError,
    error: queryError,
  } = useJobDetailQuery(id, {
    enabled: router.isReady && Boolean(id),
    select: mapJobDetailToEditForm,
    // Always refetch on Edit mount so description/fields are never stale after a recent save.
    refetchOnMount: 'always',
  });

  useEffect(() => {
    if (isError && queryError) {
      toast.error(`Error fetching job: ${queryError.message}`);
    }
  }, [isError, queryError]);

  const error = isError ? queryError?.message || 'Failed to load job' : null;
  const hasMappedJob = Boolean(jobData?.jobID || jobData?.jobNo);
  const notFound =
    router.isReady &&
    Boolean(id) &&
    !isLoading &&
    !isError &&
    (!jobData || !hasMappedJob);

  useEffect(() => {
    if (notFound) {
      toast.error('Job not found');
    }
  }, [notFound]);

  if (!router.isReady) {
    return (
      <EditJobPageLoading
        message="Please wait while we load the job"
        subMessage="Fetching job details and related data..."
      />
    );
  }

  if (!id) {
    return (
      <Container>
        <div className="text-center py-5">
          <h3 className="text-danger">Invalid link</h3>
          <p className="text-muted">No job ID was found in the URL.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => router.push("/jobs")}
          >
            Back to Jobs List
          </button>
        </div>
      </Container>
    );
  }

  if (isLoading) {
    return (
      <EditJobPageLoading
        message="Please wait while we load the job"
        subMessage="Fetching job details and related data..."
      />
    );
  }

  if (error) {
    return (
      <Container>
        <div className="text-center py-5">
          <h3 className="text-danger">Error</h3>
          <p>{error}</p>
          <button 
            className="btn btn-primary" 
            onClick={() => router.push('/jobs')}
          >
            Back to Jobs List
          </button>
        </div>
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container>
        <div className="text-center py-5">
          <h3 className="text-danger">Job not found</h3>
          <p className="text-muted">The job you are trying to edit could not be found.</p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => router.push('/jobs')}
          >
            Back to Jobs List
          </button>
        </div>
      </Container>
    );
  }

  return (
    <Container>
      <GeeksSEO title="Edit Job | SAS&ME - SAP B1 | Portal" />
      <Row>
        <Col lg={12} md={12} sm={12}>
          <div style={pageHeaderStyle}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="d-flex flex-column">
                <div className="mb-3">
                  <h1
                    className="mb-2"
                    style={{
                      fontSize: "28px",
                      fontWeight: "600",
                      color: "#FFFFFF",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    Edit Job #{jobData?.jobNo}
                  </h1>
                  <p
                    className="mb-2"
                    style={{
                      fontSize: "16px",
                      color: "rgba(255, 255, 255, 0.7)",
                      fontWeight: "400",
                      lineHeight: "1.5",
                    }}
                  >
                    Update job details, assignments, and schedules
                  </p>
                </div>

                <nav
                  style={{
                    fontSize: "14px",
                    fontWeight: "500",
                  }}
                >
                  <div className="d-flex align-items-center">
                    <i
                      className="fe fe-home"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    ></i>
                    <Link
                      href="/dashboard"
                      className="text-decoration-none ms-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Dashboard
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <Link
                      href="/dashboard/jobs/list-jobs"
                      className="text-decoration-none"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      Jobs
                    </Link>
                    <span
                      className="mx-2"
                      style={{ color: "rgba(255, 255, 255, 0.7)" }}
                    >
                      /
                    </span>
                    <span style={{ color: "#FFFFFF" }}>Edit Job</span>
                  </div>
                </nav>
              </div>
            </div>
          </div>
        </Col>
        <Col xl={12} lg={12} md={12} sm={12}>
          <Card className="shadow-sm">
            <Card.Body>
              {hasMappedJob && (
                <EditJobs 
                  initialJobData={jobData} 
                  jobId={id} 
                />
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default EditJobPage; 