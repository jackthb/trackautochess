import type { GetServerSideProps } from "next";

export default function SynergiesPageRedirect() {
  return null;
}

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: "/classes",
    permanent: true,
  },
});
