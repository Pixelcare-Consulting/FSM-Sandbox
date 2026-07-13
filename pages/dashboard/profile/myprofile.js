import { useEffect } from "react";
import { useRouter } from "next/router";
import { Spinner, Container, Row, Col } from "react-bootstrap";
import { useCurrentUser } from "@/hooks/useCurrentUser";

const MyProfile = () => {
  const router = useRouter();
  const { user, isLoading } = useCurrentUser();

  useEffect(() => {
    const profileId = user?.workerId || user?.uid || user?.id;
    if (profileId) {
      router.replace(`/dashboard/profile/${profileId}`);
      return;
    }

    if (!isLoading && !user) {
      router.push("/sign-in");
    }
  }, [router, user, isLoading]);

  return (
    <Container>
      <Row className="justify-content-center mt-5">
        <Col xs="auto">
          <Spinner animation="border" role="status">
            <span className="visually-hidden">Loading profile...</span>
          </Spinner>
        </Col>
      </Row>
    </Container>
  );
};

export default MyProfile;
